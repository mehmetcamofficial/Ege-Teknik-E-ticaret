# QA scoped DB roles — provisioning outcome and Preview cutover gate (2026-10-12)

**Status: ROLE-LOGIN E2E BLOCKED; NO PREVIEW CUTOVER.** Target `silent-waterfall-20869858` / `br-delicate-frost-awnf26nw` / `neondb`. Parent active Preview: `br-nameless-mountain-awib28a9`. Production is never a target.

## Confirmed
- QA database schema vs active Preview schema: Neon compare returned **empty diff**.
- QA migration journal: 19 rows (0000–0018).
- Integrated PR #22 head `786cbe3bb2023f287ca9d01d5d79771661d44ba2`: CI run 38186828694 success.
- The low-privilege `ege_preview_storefront_lp` inherited from Preview has SELECT on products/legal_documents, SELECT+INSERT on orders, and no admin_users/admin_invites table DML according to `has_table_privilege`. This is entitlement evidence, not authenticated E2E proof.
- The inherited `ege_preview_admin_lp` has no table DML on key admin tables; **it is NOT ready for application use**.

## Neon provisioning hazard (observed directly)
Attempted to create two unique *QA-only* LOGIN roles via Neon `create_postgres_role`:
- `ege_qa_storefront_20261012`
- `ege_qa_admin_20261012`

Both were created with **INHERIT, CREATEDB, CREATEROLE, BYPASSRLS**, membership in `neon_superuser`, and effective SELECT/UPDATE on products and SELECT on admin_users. These defaults are **incompatible** with scoped least privilege. An attempted atomic QA-only REVOKE of `neon_superuser` and ALTER ROLE was rejected (`permission denied to revoke role "neon_superuser"`); transaction rolled back. Both newly created roles were then **deleted successfully**, and a fresh pg_roles query returned zero matches. They must NOT be used or recreated without a verified ability to strip elevated privileges.

## Recommended restricted-role creation (QA ONLY)
An authorized **migration/security administrator** with the requisite PostgreSQL role administration privileges must:
1. Use a controlled, secret-safe SQL session on the **QA branch**. Explicitly verify `current_database() = neondb`, `inet_server_addr()`/host, branch identity from the verified connection metadata and **not** Production or active Preview.
2. Provision **LOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOBYPASSRLS, NOINHERIT** roles with distinct random passwords. Make sure neither role is member of `neon_superuser` or has ownership on application objects. *Do not use Neon create_postgres_role as-is for least-privilege accounts.* Do not paste passwords, full connection strings, or dumps into GitHub or ChatGPT.
3. Derive grants from exercised checkout/admin SQL operations and review the `docs/preview-scoped-checkout-rollout-runbook.md` policy. Admin DML is not yet inventoried; grant no broad `ALL TABLES`, no global write access and no PUBLIC grants. Carefully inspect sequences, schema grants, trigger/definer dependencies and legal row-lock `UPDATE` caveat.
4. Connect as **each actual role** using its own QA-only database URL. Verify `current_user`, flags and memberships. Run negative SELECT on `admin_users` / `admin_invites` and negative UPDATE/DELETE on products/orders for storefront; check permitted checkout operations **inside ROLLBACK-only transactions**. Admin role receives only reviewed admin permissions; audit its legal/finance flows and verify it cannot act as DB owner.
5. Only after a real login-based PASS, run isolated synthetic checkout HTTP E2E with the scoped flag on a QA-connected Preview deployment (never point any production deployment to QA). Keep all writes confined to QA and stop on denial/incorrect legal evidence.
6. Record test evidence without secrets, approve exact migration/role GRANT set, then use a separately approved **Preview-only** canary. Existing `CHECKOUT_SCOPED_DB_ENABLED=false` should be the initial state; never silently fall back from configured scoped users to legacy DB role. Verify flag OFF then ON with separate approval, read-only Preview smoke, and rollback OFF on regressions.
7. **Production remains NO-GO** until proven role login E2E, legal/checkout and super_admin RBAC smoke, verified backups/restore, deployment SHA and release sign-off.

## Safety note
QA role creation and removal did not modify active Preview or Production. Neon schema diff is empty. **Connection-provisioning objective was not completed** because account-level role administration privileges block creating truly restricted accounts. Do not label actual login ACL tests PASS or infer secure credentials from table privilege introspection.
