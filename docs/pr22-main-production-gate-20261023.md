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
