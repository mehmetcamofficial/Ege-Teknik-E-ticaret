# QA PostgreSQL role provisioning — SQL-only restricted roles (2026-10-12)

**Scope: isolated Neon QA branch ONLY** `br-delicate-frost-awnf26nw`, database `neondb` in project `silent-waterfall-20869858`. Do not copy these credentials, grants, or commands to active Preview or Production without separate review.

## Successfully created by SQL on QA
- `ege_qa_sf_acl` — NOLOGIN, NOINHERIT, no CREATEDB/CREATEROLE/BYPASSRLS, no `neon_superuser` membership.
- `ege_qa_admin_acl` — same.
- `ege_qa_storefront_login` — LOGIN but **PASSWORD NULL**, NOINHERIT, no CREATEDB/CREATEROLE/BYPASSRLS, no `neon_superuser` membership.
- `ege_qa_admin_login` — same.

The two LOGIN accounts are intentionally **not currently usable for password authentication**. Their username alone does not provide access. They were made with SQL `CREATE ROLE` rather than the Neon console/API role-creation action, whose actual observed role defaults were too privileged.

Verified with `pg_roles`, `pg_auth_members`, `has_table_privilege`: neither LOGIN account has SELECT on admin_users or products nor INSERT on orders. Both have database CONNECT and schema USAGE (inherited from database/schema public default grants), so privileges must be assessed per object. No table GRANT or mutations of checkout/business records performed.

## Next steps: password setup in trusted terminal (human-admin action)
The Neon connector cannot safely prompt for a PostgreSQL role password; **do not paste passwords here or commit them to a repo**. With a trusted and branch-verified PostgreSQL 18 `psql` owner session *connected only to QA*, run:

```psql
SELECT current_database(), current_user;
\password ege_qa_storefront_login
\password ege_qa_admin_login
```

`\password` prompts interactively and avoids entering plaintext role passwords as SQL literals in chat or shell history. Confirm the session host is the QA branch endpoint **before running**. Do NOT use the Neon SQL Editor to paste cleartext password strings into stored query history.

Then validate each role using its OWN QA connection (separate session), with no credentials logged:
```sql
SELECT current_user, session_user, current_database();
SELECT rolcanlogin, rolinherit, rolcreatedb, rolcreaterole, rolbypassrls
FROM pg_roles WHERE rolname=current_user;
SELECT count(*) FROM public.admin_users; -- MUST fail for storefront role (42501)
```

Do not consider the negative tests PASS until the SQL runs under the actual authenticated user. Never attempt `SET ROLE` in an owner session as a substitute. If a role unexpectedly sees confidential admin tables, stop and do not enable its connection.

## Grant plan (QA-only; NOT executed)
- Start with `GRANT SELECT ON public.products, public.legal_documents TO ege_qa_storefront_login` only after confirmed login negative tests.
- Derive actual checkout DML/row lock/function EXECUTE needs from the integrated checkout source, tracing FK, trigger, sequence and definer effects. Existing checkout runbook suggests limited customer/order/rate-limit INSERT and a legal_document row lock-specific UPDATE privilege; broad `UPDATE products`, `UPDATE orders`, and `ALL TABLES` are prohibited.
- Admin route privilege inventory is not complete; keep admin role with NO table privileges until a permission matrix and actual route tests exist.
- Keep `CHECKOUT_SCOPED_DB_ENABLED` unset/false everywhere until a separate approved Preview cutover. The `resolveScopedDatabaseUrl` guard requires distinct role usernames and identical DB host/branch to legacy `DATABASE_URL` when scoped connections are activated.

## Evidence and outcome
Neon QA versus active Preview schema diff was empty before restricted role provisioning. This work only created PostgreSQL *roles* on QA; no schema migration and no active Preview deployment change. Integration PR #22 head as of the prior verification passed 4/4 CI. Latest documentation commit requires own CI check.

**Status: SQL-only restricted roles created and privilege flags PASS; password provisioning, real LOGIN E2E, DML grants and Preview canary remain BLOCKED. Production NO-GO.**
