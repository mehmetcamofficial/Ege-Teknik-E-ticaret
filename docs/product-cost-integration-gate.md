# Confidential product cost integration — execution gate (Preview only)

Status: **NOT DEPLOYED**. This design deliberately does not store cost data until scoped connections and ACL are tested.

## Required order
1. Reconcile the canonical release branch migrations 0014–0018 before assigning a new migration number; do not create a conflicting `0014` on the old PR #21 base.
2. Merge/rebase the audited `security/db-scoped-pools-foundation` implementation into an integration branch. Its `getAdminDb()` / `getStorefrontDb()` scopes are opt-in; never treat simply configured Vercel variables as active.
3. On a disposable Neon child of Preview, provision independently credentialed non-owner `admin_runtime` and `storefront_runtime` roles. Restrict login and schema/table permissions to least privilege; do not copy the Preview owner credentials.
4. Create `product_cost_profiles` linked by immutable product ID with amount in integer kurus, currency code, updated timestamp, and audit trail. Do not use the public products API or catalog serializer to read this table.
5. Grant `admin_runtime` only required SELECT/INSERT/UPDATE privileges on the cost table and audit append permission. Explicitly REVOKE ALL from PUBLIC and `storefront_runtime`; check inherited grants, view exposure, function EXECUTE, and SECURITY DEFINER behavior. The service runtime must never be the database owner.
6. Prove with live login-role tests: storefront SELECT/INSERT/UPDATE/DELETE and indirect lookup denied; admin can perform bounded CRUD and audit writes; owner role remains inaccessible at runtime. Run the read-only SQL in `docs/sql/product-cost-acl-readonly.sql` as supporting inspection, not as a substitute for actual authorization tests.
7. In Preview only, switch confidential-cost service endpoints to `getAdminDb()`, require `super_admin`, validate input, check same-origin on writes, and audit all changes. Never pass saved costs to the LLM.
8. Verify test suite, migration apply/rollback on disposable branch and Preview smoke, then request separate Production change review.

## AI Gateway controls
- `EGE_AI_ENABLED` defaults to false; the API remains disabled until explicit activation.
- Atomic database-backed limits: 10 requests/hour per caller IP and 100 requests/calendar month global for the profitability AI endpoint. Database failure denies access.
- Requests have a 450 output-token ceiling and 15-second timeout; only manually entered text is forwarded.
- **These are request and token limits, not a monetary hard cap.** Set a provider-side spend limit before enabling the API. Record the provider, currency, and threshold in private operations settings; do not add billing credentials to source control.
- Authorized access controls and same-origin validation must be tested end-to-end; source-code assertions alone do not prove denied requests.

## Explicit non-goals for PR #21
No Production changes; no secret extraction; no cost migration on the outdated base; no test or fake costs inserted into existing datasets; no auto-merge.
