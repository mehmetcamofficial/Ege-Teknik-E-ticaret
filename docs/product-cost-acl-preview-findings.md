# Product-cost data: Preview access review (2026-10-12)

Read-only check on Ege Teknik Neon Preview branch `br-nameless-mountain-awib28a9`:

- Database: `neondb`
- Query executed as `neondb_owner`
- Roles named `storefront_runtime` and `admin_runtime`: **0 found**
- Table `public.product_cost_profiles`: **absent**

The names above are desired role concepts, not validated actual application credentials.
No password or connection URI was queried.

## Security decision

**Do not enable supplier cost storage yet.** Current `db/index.ts` relies on
a single `DATABASE_URL`. A super-admin HTTP route alone cannot isolate costs
from a compromised storefront database runtime role.

Suggested plan (not yet executed):
1. Rebase onto the actual latest security/migration integration branch.
   The PR base `quality/storefront-v2-next` currently has migrations through
   0013; other concurrent work may already use 0014–0017. Never allocate a new
   migration number blindly.
2. Review migrations, migration journal and intended roles; design a separate
   admin-only connection for cost reads and writes without changing existing
   `DATABASE_URL`.
3. On a disposable child branch, provision least-privilege admin and storefront
   roles and an isolated confidential cost table; exclude costs from all public
   responses and general analytics projections.
4. Verify storefront role CANNOT SELECT, INSERT, UPDATE, DELETE, TRUNCATE or
   use permissive function paths to cost records.
5. Test rollback/concurrency/audit, catalog regression, CI and Preview.
6. Review credentials only as presence/status flags, never print their values.
7. Require explicit separate approval before any Production migration.

AI Advisor in this PR remains *manual-question-only*, no DB tools.
`EGE_AI_ENABLED=false` until budget, throttling, env and Preview checks pass.
