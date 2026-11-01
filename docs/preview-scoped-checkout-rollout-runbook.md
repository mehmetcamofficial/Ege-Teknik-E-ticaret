# Ege Teknik — Preview scoped-checkout rollout runbook (APPROVAL REQUIRED)

**Status: PLAN ONLY.** Prepared 2026-10-10. This document is not permission to run a migration, create a database user, change Vercel environment variables, merge a PR, or deploy. Production is explicitly out of scope.

## Revision 2026-10-29 (PR #40) — what changed since the 2026-10-10 plan

This revision supersedes the parts of Phases 2–4 and the rollback section that it restates below. Everything it does not restate (backup gate, Neon facts of 2026-10-10) is **historical and must be re-read from the live Preview before use**.

- **Migration chain is 0000–0025 (26 ledger entries), not 0000–0018.** The standard migrator applies the whole chain; there is no partial application. What each late migration is for: 0017 `lock_checkout_products` (inventory/product row lock without UPDATE on products); 0018 `order_legal_evidence_guard` SECURITY DEFINER; 0019 `checkout_replay_by_key` (idempotent replay without SELECT on orders) and `p3_order_evidence_complete` SECURITY DEFINER; 0020 legacy legal acceptance immutability; 0021 second-hand inspection; 0022 notification outbox; 0023 finance permissions; 0024 outbox claim token; 0025 notification send budget (`reserve_notification_send`).
- **The stack is now PR #39 (database identity attestation) → PR #40 (this hardening).** PR #17–#19 are historical.
- **The scoped checkout pools no longer trust the URL's `sslmode`** (`lib/db-pool-config.ts`): certificate verification is pinned in code and the parameter is removed before the driver sees it. `NODE_TLS_REJECT_UNAUTHORIZED=0` makes the scoped pool refuse to be built (Preview and Production). The legacy `DATABASE_URL` pool and the notification worker pool are **unchanged** and still follow the driver's `sslmode` behaviour.
- **In Preview the scoped pools refuse a URL before any connection exists** unless it names the expected role, database and Neon endpoint of that scope. Four Preview-only variables, **names only, values never in Git or logs**, must be set for that: `EXPECTED_PREVIEW_STOREFRONT_DB_ROLE`, `EXPECTED_PREVIEW_ADMIN_DB_ROLE`, `EXPECTED_PREVIEW_DB_NAME`, `EXPECTED_NEON_PREVIEW_ENDPOINT_ID` (the same four the PR #39 attestation endpoint reads). With the flag on and any of them missing, checkout fails closed (HTTP 500) instead of connecting.
- **One reviewed grant file:** `docs/ops/checkout-storefront-grants-20261029.sql`. Its effective result is proven by `scripts/test-checkout-acl-postgres.mjs` (CI step "Checkout storefront ACL matrix") and by the HTTP gates, which all apply that same file.
- **Not proven by any of this, and still open:** a run against the real Preview Neon endpoint; that GitHub Actions passes the new CI step (`CI_REMOTE_UNPROVEN` until a run exists); the legacy and worker pools' TLS handling.


## Verified gates (2026-10-10, historical: re-verify before relying on any of it)

- Draft PR stack: [#17](https://github.com/mehmetcamofficial/Ege-Teknik-E-ticaret/pull/17) → [#18](https://github.com/mehmetcamofficial/Ege-Teknik-E-ticaret/pull/18) → [#19](https://github.com/mehmetcamofficial/Ege-Teknik-E-ticaret/pull/19). All are unmerged.
- [CI 38000674472](https://github.com/mehmetcamofficial/Ege-Teknik-E-ticaret/actions/runs/38000674472), PR #19 HEAD `37f9bd40b7073b4fa72e77519a007d18e0c9eeb9`: **quality, build, migration-safety, postgres-integration SUCCESS**. Disposable PostgreSQL 18: **22/22 integration + 38/38 commerce**; actual local Next.js HTTP E2E passed valid preview/order, evidence, stock reservation, idempotent replay/conflict, missing/tampered/expired token, stale price, out of stock, marketing refusal, **stale legal version**, **legacy flag OFF**, and **invalid scoped credentials fail-closed**.
- Neon project: `silent-waterfall-20869858`; **active Preview only** branch `br-nameless-mountain-awib28a9`, DB `neondb`. Read-only 2026-10-10: 17 Drizzle ledger entries (0000–0016), 16 orders, `lock_checkout_products(text[])` absent. The 0015 `order_legal_evidence_guard()` is SECURITY INVOKER, owned by `neondb_owner`.
- **Production branch `br-nameless-grass-aw9qpndy` must never be targeted** by this runbook.
- Existing Preview role `ege_teknik_preview_runtime`: NOLOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOBYPASSRLS, NOINHERIT. It cannot be used as an application connection until an explicitly authorized LOGIN strategy is chosen.
- Existing `ege_teknik_preview_app` has LOGIN, CREATEDB, CREATEROLE, BYPASSRLS, INHERIT; **do not use it as a restricted checkout role**.
- Neon currently lists 10 branches. Do not assume another snapshot branch can be created without checking plan limits/capacity. The separate `br-square-pond-aw0g8gus` is an **old isolated test branch**, not a fresh rollback point for active Preview; 0017 was applied there manually without updating its Drizzle ledger.

## Phase 0 — approval and immutable scope

1. Obtain explicit approval for **active Preview only**, stating the exact Neon project/branch/database and exact operations (backup, migrations 0017–0018, roles/grants, Preview Vercel environment changes). Approval for one operation is not blanket approval for subsequent operations.
2. Freeze the target PR commit SHA and confirm every PR of the stack (#39 and #40) is reviewed, merge strategy/deployment artifact is defined, and CI for that exact SHA is green. A passing Draft PR does **not** mean its code is deployed.
3. Verify Preview Vercel `APP_ENV=preview`, `NEON_BRANCH_ID=br-nameless-mountain-awib28a9`, and `EXPECTED_NEON_PREVIEW_BRANCH_ID` match, **without reading or printing secret values**. Confirm `DATABASE_URL` points to this Preview branch and `CHECKOUT_SCOPED_DB_ENABLED` is unset or `false`.
4. Schedule a short maintenance/test window. Use synthetic orders only in a deliberately isolated QA environment, not active Preview containing real orders.

## Preview backup capability check (2026-10-10)

- User authorized **backup + restore verification only**, not migrations, role changes or deployment.
- Neon native `create_snapshot` was attempted on the explicitly selected active Preview branch and rejected with **HTTP 400: `not allowed to snapshot non-root branch`**. **No native snapshot was created.**
- Neon Free v3 project has **10/10 branches** in use; no additional restore branch was created or any existing branch deleted.
- The assistant execution environment has no reachable PostgreSQL network endpoint or local `pg_dump`/`pg_restore` executables, and cannot run commands on the user's Mac. **No independent backup has yet been taken or restored.**
- The guarded local script `scripts/backup-preview-verify.sh` is available for the user to run on their own trusted Mac. It verifies the exact Preview host/role/database, checks the migration/order baseline, creates a custom-format dump, restores into an isolated Docker PostgreSQL 18 container, checks row counts, encrypts the backup, verifies decryption and prints a SHA-256 checksum. The script requires PostgreSQL 18 CLI tools, Docker, Python 3 and OpenSSL.
- The script refuses Production endpoints and makes no Neon database writes. **Do not advance to Phase 2 until the user supplies the backup file path, SHA-256 and offline restore PASS result (not credentials or the backup file itself).**

## Phase 1 — backup gate (NO MIGRATION BEFORE VERIFIED RESTORE)

1. Recheck branch ID, database name, migration ledger count/hash, table counts and relevant function definitions read-only. Stop if anything differs from the baseline unexpectedly.
2. Obtain a **new timestamped, encrypted PostgreSQL custom-format backup** of the exact active Preview DB to a private location. Do not put credentials or backup data in Git, CI logs or this document. A historical 0015–0016 backup is not sufficient for 0017–0018.
3. Compute SHA-256, verify file size, and **restore the backup to a disposable PostgreSQL 18 database**. Verify migration ledger, counts and legal-evidence constraints against the restore. Record the backup identifier, SHA-256, restore result and owner outside the repo.
4. If using a Neon branch as an additional snapshot, create it **only after explicit authorization**, confirm it forks the exact Preview branch at the intended point, and verify plan branch capacity. It supplements rather than replaces the independent dump/restore test.
5. STOP if the backup or restore verification fails.

## Phase 2 — migration gate (APPROVAL REQUIRED)

1. Ensure the release artifact includes the journal entries **0017–0025** (the whole chain after the current Preview ledger; re-read the ledger first, it was 0000–0016 on 2026-10-10). Use the repository's **standard Drizzle migrator** against the exact active Preview connection **once**; do not paste raw migration SQL and then rerun the migrator. The manually modified isolated test branch is not a migration-ledger reference.
2. Expected ledger afterwards: **26 entries (0000–0025)**. Verify 0017 `public.lock_checkout_products(text[])` and 0019 `public.checkout_replay_by_key(text,text)` exist, are SECURITY DEFINER, have a fixed search path (`pg_catalog` first), and PUBLIC has no EXECUTE on either.
3. Verify 0018 `public.order_legal_evidence_guard()` and 0019 `public.p3_order_evidence_complete()` are SECURITY DEFINER, owned by the expected trusted migration owner, with search path ending in `pg_temp` where set, and that PUBLIC has no EXECUTE on them. **Review their 0015 trigger bodies and schema CREATE privileges before applying a privileged definer.**
4. Verify existing orders, order items, legal acceptance counts and hashes are unchanged; no unintended data rewrite. If any postflight assertion fails, leave the scoped checkout feature OFF and escalate; do not run speculative repair SQL.

## Phase 3 — least-privilege LOGIN roles (SEPARATE APPROVAL)

1. Create **two distinct, dedicated, non-superuser LOGIN roles** for Preview storefront and admin (`NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION`, member of no role), with unique random passwords in the approved secrets manager. Do not reuse `neondb_owner`, `ege_teknik_preview_app`, `DATABASE_URL` credentials, or turn an existing NOLOGIN role into LOGIN without an explicit access review. The notification worker is a **third, separate** identity (below).
2. Storefront grants are exactly `docs/ops/checkout-storefront-grants-20261029.sql`, applied with `psql -v ON_ERROR_STOP=1 -v storefront_role=<role>`. What each part is for: **inventory lock** `lock_checkout_products` EXECUTE + column UPDATE on `inventory` + `UPDATE (created_at)` on `legal_documents` (needed by `SELECT … FOR SHARE`); **replay** `checkout_replay_by_key` EXECUTE, with **no SELECT on orders, customers, addresses, order_items or order_legal_acceptances**; **legal evidence** INSERT on `order_legal_acceptances` and SELECT on `legal_documents`/`legal_document_versions` (the 0018/0019 definer guards read the parent order, so no UPDATE on orders is needed); **rate limit** SELECT/INSERT/column UPDATE/DELETE on `rate_limit_buckets`. **No UPDATE on orders or products, no DDL, no sequence, no CREATE, no PUBLIC or GRANT OPTION grant, no elevated role membership.** Do not add a grant reflexively; see Phase 4 step 5.
3. **Notification outbox (optional, separate approval):** `docs/ops/notification-outbox-grants-20261022.sql` grants the storefront `INSERT` on `notification_outbox` only. Without it the order still commits (the enqueue runs in a SAVEPOINT) and the worker sweep re-queues the order's notifications within 30 minutes. **Notification worker:** `docs/ops/notification-worker-grants-20261024.sql` (after 0024 and 0025) creates its own dedicated identity for `NOTIFICATION_WORKER_DATABASE_URL`; the worker never runs on the storefront, admin or `DATABASE_URL` connection and never reads `admin_users`. For the **admin** role, `getAdminDb()` exists but no route uses it: it holds schema USAGE and nothing else, and **admin route migration is not part of this checkout canary**.
4. Using separate LOGIN connections, assert `current_user`, `rolsuper=false`, `rolcreatedb=false`, `rolcreaterole=false`, `rolbypassrls=false`, `rolreplication=false`, product/order UPDATE denied, orders/customers SELECT denied, both checkout functions EXECUTE allowed and PUBLIC EXECUTE absent on every SECURITY DEFINER function. `scripts/test-checkout-acl-postgres.mjs` is the executable form of this list and runs on a disposable cluster only; it is never pointed at Preview. Never expose passwords in logs or PR comments.

## Phase 4 — staged Preview application activation (SEPARATE APPROVAL)

1. Deploy/release the exact reviewed code (PR #39 + PR #40 SHA, CI green for that exact SHA) to a **controlled Preview deployment** only, with the flag **OFF**. Confirm environment and branch guards and perform read-only smoke tests. No Production deployment.
2. Set `STOREFRONT_DATABASE_URL` and `ADMIN_DATABASE_URL` as protected **Preview-only** secrets pointing to the same branch/database as the legacy `DATABASE_URL`, but different dedicated role usernames, and set the four `EXPECTED_PREVIEW_*` / `EXPECTED_NEON_PREVIEW_ENDPOINT_ID` variables to the matching role names, database and Neon endpoint id. `NODE_TLS_REJECT_UNAUTHORIZED` must be unset or not `0`. Both URLs are required by `resolveScopedDatabaseUrl`, even though only storefront checkout is activated. A `sslmode=` parameter in these URLs is tolerated and ignored by the scoped pools.
3. With `CHECKOUT_SCOPED_DB_ENABLED=false`, verify existing checkout behavior, then (PR #39 attestation endpoint, separately approved) verify the two scoped identities. **A 200 there proves configuration and identity; it does not prove checkout traffic runs on those connections.**
4. **Activation:** in a separately approved controlled Preview release, set `CHECKOUT_SCOPED_DB_ENABLED=true` and run legal-preview + order-path smoke tests against **synthetic, non-sensitive** fixtures under an authorized QA process. Observe HTTP errors, rate limits, legal evidence, order totals and stock integrity. A scoped pool that cannot be built (identity, TLS or configuration) shows up as a generic HTTP 500 on both checkout endpoints. The refusal carries fixed reason codes, but the public route logs only the error class, so diagnose with the PR #39 attestation endpoint (its 422/503 answers list the same reason codes) or by reproducing locally; never by reading URLs or secrets.
5. If any scoped connection fails, **do not grant extra privileges reflexively** and do not silently fall back to owner credentials. Record the missing privilege, assess and test the smallest change in disposable CI (the grant file, its tests and the ACL matrix) before another approval.

## Rollback (each step is separate; stop at the first one that is enough)

1. **Flag rollback (first and usually sufficient):** set the **Preview-only** `CHECKOUT_SCOPED_DB_ENABLED` back to `false` and redeploy the last reviewed Preview build; keep migrations 0017–0025 in place (additive or trigger-metadata changes) while investigating. Confirm requests use the legacy path (`getDb()`) and validate order/stock integrity. This does **not** remove already-written orders. Idle scoped pools are never used again once the flag is off.
2. **Credential incident:** disable/rotate the affected dedicated LOGIN credentials with an approved coordinated change; leave the flag OFF. Never rotate or alter Production credentials.
3. **Grant rollback:** revoke only what the canary added (the grant file has no GRANT OPTION, so a `REVOKE … FROM <storefront role>` of the same statements is complete); do not drop a role that owns nothing without an access review.
4. **Database restore:** a full restore overwrites current data and can lose orders placed since the backup. **Never restore active Preview or reverse the SECURITY DEFINER status of 0018/0019 automatically.** A database restore or down-migration requires a separate incident decision, write freeze, comparison of intervening orders/evidence, verified restore plan and explicit authorization.

**Stop criteria (any of them means: flag off, stop, report):** unexpected branch ID, backup mismatch, migration checksum/ledger mismatch, privileged runtime connection, a scoped pool refusing its URL, legal-evidence mismatch, unauthorized writes, secret leakage, HTTP 500/409 regression, inventory mismatch, or unexplained trigger behavior.

## Sign-off record (fill in only after authorized execution)

| Gate | Result | Evidence |
| --- | --- | --- |
| Exact PR HEAD and CI (PR #39 + PR #40) | NOT RUN | `CI_REMOTE_UNPROVEN` until an Actions run exists; the 2026-10-10 run `38000674472` covered the old #17–#19 stack |
| Fresh Preview backup and offline restore | NOT RUN | — |
| 0017–0025 on active Preview | NOT RUN | — |
| Preview LOGIN roles and ACLs (canonical grant file) | NOT RUN | — |
| ACL matrix on a disposable cluster (`test-checkout-acl-postgres`) | NOT RUN in CI yet | — |
| Preview deployment and scoped OFF smoke | NOT RUN | — |
| Preview scoped ON canary | NOT RUN | — |
| Production | OUT OF SCOPE | Do not modify |
