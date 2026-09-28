# Release runbook (Production)

Follow the steps in order. **Any failed check is a STOP**: do not repair automatically, report it. Nothing here is automated by CI;
CI only proves the commit is releasable (`quality`, `postgres-integration`, `build`, `migration-safety` must be green).

## 0. Preconditions

- Release commit is on the release branch, CI green on that exact SHA, reviewed and merged per [branch-protection.md](branch-protection.md).
- `pnpm verify:migrations` passes (migrations 0000-0012 byte-identical to what Production has applied).
- Environment contract satisfied ([environment-contract.md](environment-contract.md)); new variables are added **before** the deployment that needs them.
- Legal/business gates that block order acceptance are known (the checkout fails closed without published legal documents).

## 1. Decide whether the release needs a migration

`git diff --name-only <production-sha>..<release-sha> -- drizzle-pg`. No new files: skip to step 5.
A migration is **forward-only**. The application deployed before it must tolerate the migrated schema (additive changes only), and the new
application must not be deployed before the migration is applied.

## 2. Read-only Production preflight (credential file mode 600, never printed)

Required in the file: `DATABASE_URL`, `DATABASE_URL_UNPOOLED` (direct), `APP_ENV=production`, `MIGRATION_TARGET_ENV=production`,
`NEON_BRANCH_ID` and `EXPECTED_NEON_PRODUCTION_BRANCH_ID` = `br-nameless-grass-aw9qpndy`.

1. Refuse if the pooled/direct classification is wrong or any host names the Preview endpoint.
2. Connect with `default_transaction_read_only=on`; verify `SHOW transaction_read_only` / `default_transaction_read_only` are `on`.
3. **Identity from the server, never from the hostname:** `current_setting('neon.branch_id')` must equal the Production branch and
   `neon.endpoint_id` the known Production endpoint. Anything else: STOP.
4. Ledger equals the repository journal prefix (hashes and `created_at`), row counts match expectations, no locks, no prepared transactions,
   no idle-in-transaction sessions.
5. Read the SQL of every pending migration and simulate its data-dependent guards with SELECTs (e.g. 0011 needs exactly one active owner).

## 3. Recovery point (before the first write)

Create a Neon child branch of the Production branch (name it `pre-<release>-production-<date>`); verify parent id and `ready` state.
A no-compute branch is enough. History retention is short (currently 6 h), so do not rely on point-in-time restore alone.

## 4. Apply migrations (only if step 1 found any)

`pnpm db:migrate` with `MIGRATION_TARGET_ENV=production`, `ALLOW_PRODUCTION_MIGRATION=I_UNDERSTAND_PRODUCTION` and the direct URL.
The hardened runner (direct-URL check, `lock_timeout` 10 s, `statement_timeout` 120 s, 300 s watchdog, single transaction) applies all pending
migrations together or none. On any error: STOP, do not retry, verify read-only that the ledger is unchanged.
Then verify read-only: ledger complete and hash-equal, expected tables/columns/constraints, data counts, admin state, no locks.

## 5. Deploy

Deploy exactly the release SHA to Production through the existing Vercel project (Git deployment redeployed with `--target=production`, or the
project's promotion flow). Require: target `production`, `READY`, deployment metadata SHA equals the release SHA. Never infer a URL from the
project name; read it from `vercel ls` / the deployment API.

The Order-status admin UI and API are one deployment; see [expected-status-coupled-release.md](../technical-debt/expected-status-coupled-release.md).

## 6. Verify (GET only until identity is proven)

1. **First request:** `GET /api/health` on the new deployment: HTTP 200, `environment=production`, `branchId=br-nameless-grass-aw9qpndy`. Then the same on `https://egeteknik.tr`.
2. Public smoke (GET): `/`, `/catalog.html`, product page, `/checkout.html`, `/regions.html`, `/services.html`, `/contact.html`, `/blog.html`, `/admin/login`, `/api/products`, `/api/checkout/charges`.
3. Boundaries: `/admin`, `/admin/products`, `/admin/orders` redirect to `/admin/login`; `/api/admin/*` returns 403 unauthenticated.
4. Contracts: product count and delivery classes, 81 provinces / 973 districts, shipping still `pending`.
5. Read-only DB re-check: business data unchanged; only expected authentication writes (sessions, audit, rate-limit buckets).
6. An operator signs in once through the normal login and confirms the admin UI (order detail, product list) works. No mutations.

## 7. Close

Delete temporary credential files and scripts, close DB sessions, record the release (SHA, deployment id, migration range, recovery branch).
Removing a recovery branch is a separate, deliberate decision after the release has proven stable.

## STOP conditions

Identity mismatch (branch, endpoint, environment) - ledger not as expected - a migration error - postflight differs - `/api/health` differs -
smoke or boundary check fails - unexpected business-data change. Then follow [rollback-runbook.md](rollback-runbook.md); never improvise SQL on Production.
