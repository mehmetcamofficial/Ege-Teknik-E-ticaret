# Ege Teknik — QA branch and role matrix verification (2026-10-12)

## Scope and isolation
- Deleted test branch `br-square-pond-aw0g8gus` was absent when verified after the owner's manual removal.
- Created new Neon child of **Preview only**: `qa-admin-pro-legal-acl-20261012` (`br-delicate-frost-awnf26nw`).
- No SQL writes, privilege changes, connection secrets, or Production/active Preview configuration updates performed.
- Child migration journal: 19 entries (IDs 1–19; 0000–0018).
- Integration PR #22 head `50b5bb4376ccdba570e065cf11d0a93bad1c8a3d`: CI run 38186653287 **success** (confirm detailed job breakdown before release).

## Read-only privilege matrix in QA branch
PostgreSQL `has_table_privilege` reports:
- `ege_preview_storefront_lp`: products SELECT only; orders SELECT/INSERT (no UPDATE/DELETE); legal_documents SELECT only; admin_users and admin_invites no SELECT/INSERT/UPDATE/DELETE.
- `ege_preview_admin_lp`: no SELECT/INSERT/UPDATE/DELETE on sampled products, orders, legal_documents, admin_users, admin_invites. **Not currently viable as an admin runtime**.
- `ege_preview_storefront` (legacy): SELECT/INSERT/UPDATE/DELETE on ALL those sampled tables; membership in `neon_superuser`, `INHERIT`. **Unsafe to designate as restricted storefront runtime**.
- `ege_teknik_preview_app`: inherited `neon_superuser` membership; still wide privileges.
- These checks are SQL catalog-derived capability results, **not actual authenticated role-connection end-to-end tests**.

## Role test attempt
Tried a transaction-scoped `SET LOCAL ROLE ege_preview_storefront_lp` on the disposable branch for live negative read checks. PostgreSQL returned `permission denied to set role`; no role elevation was performed and the transaction failed. Do **not** treat this as a negative read test. Do not try to bypass authorization.

## Remaining production blockers
1. Test using actual separately credentialed login-role database connections on the disposable QA branch (Neon connector SQL owner session does not impersonate them). No credentials in chat/logs.
2. Design and verify minimum admin permissions, including admin_users/invites and legal/checkout transactions. Check exact runtime endpoint connection selection and revoke legacy unsafe role access via reviewed migration/cutover only.
3. Validate protected role boundaries, legal/checkout negative mutations, SQL privileges, and migration hashes on QA. Preserve Production and active Preview.
4. Run smoke tests for the exact integrated PR and obtain explicit production authorization.
5. AI remains disabled until provider-side hard monetary cap and user authorization; Agrotech viewer remains active.

**Decision**: Integration CI PASS; QA isolation PASS; scoped storefront role entitlement matrix preliminarily PASS; admin runtime and authenticated negative-role tests BLOCKED; Production NO-GO.
