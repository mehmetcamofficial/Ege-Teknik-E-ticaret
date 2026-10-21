# QA PII Read Privilege Reduction — Verified Catalog Result

Date: 2026-10-12. Scope **ONLY** Neon project `silent-waterfall-20869858`, QA branch `br-delicate-frost-awnf26nw`, database `neondb`. Active Preview / Production untouched.

## Change executed
Connected as `neondb_owner`, verified migrations 19 and storefront role ACLs before change. Executed:
```sql
REVOKE SELECT ON TABLE public.customers, public.addresses FROM ege_qa_storefront_login;
```
Post-change independently checked `has_table_privilege()` and `pg_class.relacl`:
- `customers_read=false`, `addresses_read=false`
- `customers_insert=true`, `addresses_insert=true`
- Both table ACL entries for the role: `ege_qa_storefront_login=a/neondb_owner` (`a` = INSERT).

## Not yet independently proven
- Real psql login `SELECT count(*)` denied for both tables (expected SQLSTATE 42501); execute from existing QA storefront session.
- Full scoped checkout remains untested after ACL changes, including FK insert, legal evidence triggers, stock rollback and idempotent replay.
- `orders`, `order_items`, and `order_legal_acceptances` full SELECT remain TRUE. SQL credential compromise allows direct row enumeration. P0 remains open. No RLS or trust-bound replay function implemented.
- Existing guest order lookup uses legacy getDb(), not the scoped storefront role; separate work is required.

## Follow-up architecture
Prefer permission-isolated server-side replay lookup: fixed definer ownership, restricted EXECUTE grants, `pg_catalog, public, pg_temp` search_path and a minimal output projection, explicit idempotency fingerprint validation; do not expose arbitrary order-ID lookups, secret tokens or raw rendered legal bodies. Retain application-level legal evidence validation semantics, strict transaction locking and fail-closed behavior. Refactor route to call this boundary, then revoke direct order/evidence SELECT only after QA HTTP/SQL regression PASS. Keep Production NO-GO.

Evidence: GitHub PR #22; earlier `docs/p0-storefront-pii-minimization-20261012.md`.
