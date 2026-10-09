# Scoped checkout — isolated HTTP E2E gate

## Current verified baseline
- Draft stack: PR #17 (legal immutability) → #18 (scoped DB connection gate) → #19 (checkout row lock and hardened legal evidence trigger).
- Migration 0017 and 0018 are **not** applied to active Neon Preview or Production.
- Disposable PostgreSQL 18 tests verify restricted LOGIN transaction and two legal acceptance records without any `orders` UPDATE grant.
- `tests/checkout-scoped-http-contract.test.ts` checks source-level HTTP handler wiring; it is not an HTTP E2E test.
- `scripts/test-checkout-http-e2e.mjs` launches real Next.js HTTP handlers against the CI-owned PostgreSQL 18 service container. [Run 38000674472](https://github.com/mehmetcamofficial/Ege-Teknik-E-ticaret/actions/runs/38000674472) passed all four jobs, 22/22 integration tests, 38/38 commerce tests, and real HTTP preview/order/replay/conflict plus negative cases, stale legal version, legacy-off and invalid scoped-credential fail-closed.

## Required isolated test environment
1. Start a **disposable local PostgreSQL 18 database** and apply migrations 0000–0018 with the repository migrator. Refuse any database URL that is not loopback with a database name starting `sprintb`. Never reuse active Preview/Production connection strings.
2. Seed one published online product with inventory and three published/effective legal documents: `distance-sales`, `pre-information`, and the actual KVKK notice slug required by `missingNoticeSlugs`. Seed only fictitious customer data.
3. Create distinct **LOGIN** roles for storefront and admin. The storefront role must have no `products` UPDATE, no `orders` UPDATE (including columns), no superuser/CREATEDB/CREATEROLE/BYPASSRLS, and must have explicit EXECUTE on `lock_checkout_products(text[])`. Grant only the read/insert and column-level inventory/rate-limit privileges required by checkout. Never use a Neon privileged role.
4. Launch a **local Next.js server** with `CHECKOUT_SCOPED_DB_ENABLED=true`, all three database URLs pointing at that disposable local database with separate role names, and synthetic test-only signing/hash secrets. The application's `APP_ENV` / `NEON_BRANCH_ID` guard must be satisfied by an explicitly isolated test configuration, never by substituting real Preview/Production branch IDs.
5. Prove the launched process actually uses the restricted LOGIN role for both checkout endpoints before sending any order-writing request. A local URL alone is not evidence that its DB is disposable.

## HTTP scenarios (run against a real local Next.js server)

Verified at HEAD `37f9bd4` on [CI 38000674472](https://github.com/mehmetcamofficial/Ege-Teknik-E-ticaret/actions/runs/38000674472): valid preview, order 201, legal evidence, inventory reservation, replay and idempotency conflict, missing/tampered/expired token, marketing opt-in, stale displayed total, out-of-stock rollback, stale published legal version, legacy flag OFF, invalid scoped credentials fail-closed and response leakage checks. **These were executed on disposable local PostgreSQL and Next.js, not on active Neon Preview or Production.**
- `POST /api/checkout/legal-preview`: valid fictitious cart returns signed preview token and both rendered legal documents; no order or inventory mutation.
- `POST /api/orders` with the exact preview token and accepted version IDs: HTTP 201; one order, one item, two immutable acceptance records, exactly one inventory decrement and reservation.
- Identical idempotency key and body: replay returns the original order with no second stock decrement or evidence records.
- Same key, different body: HTTP 409 with `IDEMPOTENCY_KEY_REUSED`.
- Missing/tampered/expired legal preview token: refusal, no order and no inventory decrement.
- Stale legal document version, incorrect displayed total, out-of-stock and marketing opt-in: refusal without partial writes.
- Verify no response leaks internal DB IDs, passwords, connection strings or raw SQL errors.
- With `CHECKOUT_SCOPED_DB_ENABLED=false`, legacy path remains operational on the same disposable database; missing/invalid scoped credentials must fail closed when enabled.

## Release hold
Do **not** merge, run migrations on active Preview/Production, provision production credentials, or enable the scoped checkout flag based on these instructions alone. See `docs/preview-scoped-checkout-rollout-runbook.md` for the exact approval-gated backup, migration, role, deployment and rollback gates.
