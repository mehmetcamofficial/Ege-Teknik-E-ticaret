# Ege Teknik — PR #22 reconciliation into current main (2026-10-23)

Status: **NO-GO / isolated evaluation branch only**. No Production or Preview configuration, migration, database, secrets, or Vercel deployment was changed.

## Verified current GitHub facts
- PR #22 is **draft**, open, and targets `security/checkout-product-lock-0017` — **not main**.
- PR #22 head is `1c51d5ac9752e76928988d80e21f402ecc1ac80a` on `integration/admin-pro-legal-security-20261012`.
- GitHub compare of **main** against PR #22 head returned **no common ancestor**; this PR must not be merged directly into main or force-merged.
- PR #22 has a successful CI run on its own SHA, which does **not** prove current-main compatibility or production readiness.
- Main migration journal includes **0021_second_hand_inspection**, **0022_notification_outbox**, and **0023_finance_permissions**. PR #22 head ends at **0020_legacy_legal_acceptance_immutability**.
- Existing finance/AI code already exists in main; files differ in `finance-view.tsx`, `profitability-calculator.tsx`, and `profitability-gateway.ts` and require review before selecting newer/correct behavior. Some other finance files have identical blobs.

## Mandatory release gates
1. Inventory per-file differences against current main, explicitly preserve all migrations 0000–0023 and checkout/legal/privacy/RBAC/backup behavior. Do not copy PR #22's older migration journal or broad ACLs.
2. Reapply only *missing*, verified features using focused commits on a new branch based on main; resolve overlapping finance/AI behavior with tests rather than wholesale copy.
3. Run all required CI, migration-safety, PostgreSQL integration, legal/checkout negative tests and scoped-role login tests. Treat skipped real-runtime gates as pending, not PASS.
4. Verify current Neon Preview/Production migration journals and schema compatibility read-only before any database write.
5. Confirm disabled-by-default profitability AI, RBAC deny tests and payment-disabled public checkout behavior, full rollback readiness.
6. Only after gates pass, merge the new main-based PR; then inspect Vercel Preview and explicitly approve a separately controlled Production promotion.

**Decision:** Do not merge PR #22, run Production migrations or trigger Production deployment until these gates pass. Existing production backup remains unchanged.

## Focused source reconciliation — 2026-10-23

Compared current main with PR #22 at immutable SHA for the following overlapping implementation files. Decision is **keep current main**, not cherry-pick older versions:

| Area | PR #22 vs current main | Resolution |
| --- | --- | --- |
| `dashboard-view.tsx`, `products-view.tsx`, `admin-shell.tsx` | Identical blobs | Already integrated; no copy needed |
| `finance-view.tsx`, `orders-view.tsx` | Current main adds `DataError` with retry; orders also has `OrdersSummary` | Keep newer accessible retry and order summary |
| `profitability-calculator.tsx` | Current main adds 15-second timeout, privacy disclosure and revised request states | Keep current main |
| `lib/ai/profitability-gateway.ts` | Current main uses centralized `gatewayDecision`, budget enforcement and topic-only outbound request | Keep current main; old standalone AI gateway is a security regression |
| `app/api/admin/finance/profitability/ai/route.ts` | Current main supplies `aiBudget` and bounded user-facing failures | Keep current main |
| `lib/admin-auth.ts` | Current main includes `effectivePermissions` and denied-action auditing | Keep current main; old file would remove security features |
| `lib/admin-ui.ts` | Current main includes finance role and permission labels | Keep current main |
| `drizzle-pg/meta/_journal.json` | Current main extends to 0023; PR #22 only to 0020 | Keep main; never roll back journal |

New `tests/pr22-main-reconciliation.test.mjs` is a non-destructive regression guard for these decisions. This does **not** certify that all 63 PR #22 files were reconciled or that real Preview/Production DB gates passed. The remaining review must focus on checkout API, migrations and remaining test/script differences before Production promotion.

## Checkout/legal and live Neon role verification — 2026-10-23

- Identical Git blobs between PR #22 and current main: `lib/scoped-checkout-replay.ts`, `lib/http-security.ts`, `scripts/test-legal-postgres.mjs`, `tests/checkout-compliance.test.ts`, `tests/legal-checkout.test.ts`, `drizzle-pg/0019_scoped_checkout_replay.sql`, `drizzle-pg/0020_legacy_legal_acceptance_immutability.sql`. Keep main.
- `app/api/orders/route.ts`: main adds `enqueueOrderNotifications` via savepoint; PR #22 lacks this later outbox behavior. Keep main.
- Live **read-only** Neon migration count: Preview `br-nameless-mountain-awib28a9` = 19 rows, max id 19; Production `br-nameless-grass-aw9qpndy` = 14 rows, max id 14. Current main journal ends at 0023; no database migrations applied.
- Live Preview connection as `ege_preview_storefront_lp`: LOGIN true, NOINHERIT, BYPASSRLS false, SELECT products true, SELECT admin_users false, SELECT legal_documents true, INSERT orders true. This is entitlement evidence only, not complete HTTP checkout proof.
- Live Preview connection as `ege_preview_admin_lp`: LOGIN true, NOINHERIT, BYPASSRLS false, SELECT products/admin_users/legal_documents false and INSERT orders false. Not a functioning admin runtime as currently granted.
- Live Preview connection as `ege_preview_storefront`: LOGIN true, INHERIT true, BYPASSRLS true, SELECT admin_users true. **Do not use for restricted storefront**.
- `to_regclass('public.legal_acceptances')` is null in Preview; inspect actual legal table names and schema mappings before migration planning.
- Real negative ACL queries and real HTTP checkout, migration dry-run, full CI, Preview runtime identity and Vercel deploy remain outstanding. **Production NO-GO**.

## Existing isolated QA branch checks — 2026-10-23

- Attempt to create fresh Preview child `qa-pr37-acl-isolated-20261023` was rejected by Neon with **HTTP 422 branches limit exceeded**. No branch created, no deletions or writes.
- Existing QA child `br-spring-scene-aw3gf2qf` (`qa-checkout-e2e-isolated-20261014`) inspected **read-only**: 20 applied migration rows (max id 20). Legal acceptance table is **`public.order_legal_acceptances`**, not `public.legal_acceptances`; earlier missing-table observation is a naming mismatch, not evidence of missing legal acceptance support.
- Actual login as `ege_qa_storefront_login`: LOGIN true, NOINHERIT, BYPASSRLS false; products SELECT true, admin_users SELECT false, orders SELECT false / INSERT true, legal_documents SELECT true, order_legal_acceptances INSERT true. Direct `SELECT count(*) FROM public.admin_users` **permission denied**; products count **89**.
- Actual login as `ege_qa_admin_login`: LOGIN true, NOINHERIT, BYPASSRLS false; admin_users SELECT true, products SELECT false, orders SELECT/INSERT false, legal_documents SELECT false. Direct `SELECT count(*) FROM public.products` **permission denied**; admin_users count **3**.
- These are **real authenticated SQL role / negative permission checks**, but not full runtime HTTP checkout or admin RBAC proofs. The QA branch is older than current main (through migration 0020 vs 0023) and cannot certify the final release schema. Fresh isolated migration dry-run is blocked by Neon branch limit; do not delete existing branches without approval.

## Isolated PR37 migration/ACL gate — 2026-10-23 (follow-up)

- User-approved deletion: archived `pre-production-schema-2026-09-23` (`br-odd-boat-awja30k5`). New Preview child: `qa-pr37-migration-acl-20261023` (`br-broad-rain-awuc5ogv`). No Production/Preview writes.
- Applied migration **SQL** 0019–0023 in separate per-file transactions to QA child, all successful. Verified checkout replay and legal immutability functions, outbox table, eight used-product inspection columns. **Drizzle migration ledger still contains 19 entries**: this is a partially recorded state, not a complete Drizzle migration. Do not rerun migrations or manually insert ledger rows without an audited reconciliation procedure; do not promote this branch.
- Authenticated SQL on isolated child as `ege_preview_storefront_lp`: `admin_users` SELECT denied (PASS); `orders` SELECT **allowed** (16 rows), `order_legal_acceptances` SELECT **allowed** (30 rows), both FAIL for least privilege; `checkout_replay_by_key` EXECUTE **denied**, FAIL; `notification_outbox` INSERT **denied**, FAIL for outbox enqueue if scoped role is used.
- Authenticated SQL as `ege_preview_admin_lp`: `admin_users` SELECT denied; not usable for expected admin reads. `ege_preview_storefront` has BYPASSRLS true; never treat as restricted storefront.
- `scripts/test-checkout-http-e2e.mjs` explicitly refuses any remote Neon URL: it requires CI=true, loopback host, `sprintb*` disposable database and drops public/drizzle schemas. **Do not run it against Neon**. Native loopback PostgreSQL/Next server access is required for actual HTTP checkout E2E; no such HTTP test was executed in this verification.
- Result: SQL schema apply PASS, live least-privilege gate FAIL, Drizzle history BLOCKED, native HTTP E2E BLOCKED. Production NO-GO.

## Isolated storefront ACL remediation — 2026-10-23

On QA child `br-broad-rain-awuc5ogv` only, revoked direct SELECT on orders, order_items, order_legal_acceptances, customers, addresses from `ege_preview_storefront_lp`; granted EXECUTE on `checkout_replay_by_key(text,text)` and INSERT on notification_outbox. Verified authenticated storefront SQL: orders SELECT false, legal evidence SELECT false, admin_users SELECT false, replay EXECUTE true, outbox INSERT true. All five entitlement checks PASS. Admin role remains unremediated. The branch still has 19 Drizzle ledger entries despite schema SQL through 0023; no manual ledger insertion. Local loopback HTTP E2E not run because local PostgreSQL/Next runner is unavailable in connector environment. Production/Preview untouched; NO-GO.
