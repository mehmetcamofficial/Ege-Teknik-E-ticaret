# Admin Pro — Production release gate (2026-10-12)

**Status: PREPARED, NOT APPROVED FOR PRODUCTION.** Pull request #21 is draft and targets `quality/storefront-v2-next`, not `main`. Do not merge, promote, or redeploy Production as part of this review.

## Verified
- Head before documentation updates: `7a74ed64b63785f21d665b7d61a4fb7e8ee79d76`.
- CI run 38184683075: success (4/4 checks). Vercel Preview status: success.
- Manual authenticated Preview acceptance report: desktop, navigation search, catalog and order filters, finance dashboards, details.
- Viewer `infoagrotechinsights@gmail.com`: role shown as Viewer; direct profitability page request returned to dashboard according to provided screenshots. Account **must remain active** per owner request.
- User-verified 390px mobile navigation, orders and finance display.
- Code requires `super_admin` and `payments:configure` for calculator and AI API; endpoint returns generic denial and no-store headers. AI requires explicit `EGE_AI_ENABLED=true` and server-side API key/model.
- AI caller IP: 10 requests / hour; global: 100 / UTC month, atomic PostgreSQL claim; output max 450 tokens; 15s timeout.
- Calculator is local scenario-only: no persisted supplier costs, no product/order/stock mutations.

## Blocking conditions before Production release
1. **Branch and migration reconciliation.** Determine the authoritative release tip and map migration 0014–0018 across security branches. The PR has an older base; merging straight into Production is unsafe even when CI succeeds.
2. **Explicit AI off confirmation.** Verify Production `EGE_AI_ENABLED` is unset/false without reading secret values. Do not enable AI during the UI release. A provider-side monetary spend cap, real model price, and authenticated end-to-end negative tests are required before any later AI launch.
3. **Secrets and DB separation.** Preview works with legacy DATABASE_URL. No confidential cost table or additional runtime roles have been deployed. Do not represent the current UI as an ACL-isolated cost system. Merge scoped DB foundations separately only after database role and inherited-privilege tests.
4. **Release checks on exact proposed merge SHA.** lint/typecheck/tests/build, migrations, permission tests for viewer and super_admin, order/finance read-only smoke, responsive check, and no unexpected environment differences.
5. **Production rollout authorization.** Confirm backup/restore point, rollback target, deployment health checks, and authorized release window; obtain explicit promotion approval. Only then deploy Production.

## Release smoke / rollback
- Before: capture current Production deployment ID, production Neon branch ID, migration journal, restore checkpoint, and read-only API health; never copy Production secrets into logs.
- After: /api/health; admin auth boundaries; catalog/order/finance GET; basic mobile UI. Do not create real orders or record payments as a smoke test.
- Roll back the Vercel deployment if GET regressions are detected; DB schema changes require a separately reviewed migration recovery plan (Vercel rollback alone does not roll back SQL).

## Decision
**Admin Pro UI acceptance: PASS. Security/Production promotion gate: BLOCKED pending explicit items above. AI remains OFF.** Agrotech Viewer account remains enabled.
