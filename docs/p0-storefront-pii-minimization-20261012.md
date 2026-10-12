# P0 — Storefront database PII minimization, approval-gated implementation plan

Scope: Ege Teknik PR #22 integration branch; isolate to Neon QA `br-delicate-frost-awnf26nw` before any approved Preview or Production operation. **This file is a plan. It does not authorize applying any REVOKE/GRANT/DDL.**

## Grounded code findings
- `app/api/orders/route.ts` scoped checkout uses `getCheckoutDb()` (only if `CHECKOUT_SCOPED_DB_ENABLED=true`). It INSERTs into `customers` and `addresses` but does not read either table on this path.
- Same route SELECTs `orders` by idempotency key, `order_items` and `order_legal_acceptances` for replay. It SELECTs `products`, `inventory`, `legal_documents` and `legal_document_versions` during approval and reserves stock on `inventory`.
- `lib/order-lookup-db.ts` uses `getDb()` (legacy role), not scoped storefront role, and reads `orders` plus `order_items`, with order-number+email match checked in application after retrieving the order row. This is a separate legacy-credential concern, not solved by storefront ACL alone.
- `lib/http-security.ts` default `rateLimit` uses legacy `getDb()` except where checkout explicitly passes scoped db. A comprehensive runtime scope inventory is needed.
- QA `ege_qa_storefront_login` currently has full `SELECT` on `customers`, `addresses`, `orders`, `order_items`, `order_legal_acceptances` and RLS is off. That role can enumerate existing PII if compromised.
- `db/index.ts` scoped URL checks require both storefront+admin URLs and matching legacy endpoint. Scoped checkout flag still OFF in deployed environments.

## Step A — Smallest QA permission reduction (explicit approval required)
After taking a before-grants snapshot and checking no other active QA application uses this role:
```sql
BEGIN;
REVOKE SELECT ON TABLE public.customers, public.addresses FROM ege_qa_storefront_login;
COMMIT;
```
Do **not** touch INSERT or FK privileges. Verify direct role SELECT denied, INSERT remains true. FK checks are internal PG referential integrity. Run scoped checkout transaction tests and rollback. If any relevant read dependency is found, halt and revise; do not blindly regrant.

**Acceptance**: real storefront login `SELECT ... FROM public.customers` and `addresses` fail with SQLSTATE 42501; catalog read, orders INSERT and FKs continue to work in synthetic QA test; admin role unaffected.

## Step B — Remove broad order/evidence SELECT (architecture work, NOT a quick grant change)
Build narrow `SECURITY DEFINER` stored procedure(s) with search_path `pg_catalog,public,pg_temp`, fixed owner and no `PUBLIC EXECUTE`, parameterized keys, tight return projection and unconditional order ownership/context checks. Alternative: scoped RLS with a server-trusted session context that clients cannot spoof. DO NOT use a user-configurable GUC by itself as proof of authorization.

The replay pathway currently has a two-read shape (`orders`, then `order_items` and legal evidence). The refactor must retain fingerprint validation, legal evidence integrity checks, idempotent replay, no side effects and transaction lock order. Avoid defining a function that accepts arbitrary order IDs and returns PII. For legal evidence, return only the minimum fields needed for existing `validatePersistedLegalEvidence` or execute validation inside a constrained trusted routine. Review `order_legal_acceptances.rendered_body` and snapshots for accidental disclosure.

Verify separate guest order lookup does not rely on legacy owner privileges indefinitely: `lib/order-lookup-db.ts` currently uses getDb and app-level comparison. Prefer a separate limited lookup role and a rate-limited ownership-verifying query/function. Order number+email is not as strong as account authentication; consider additional verification for sensitive data.

## Step C — Tests / rollout gates
- Negative real-login SQL on all PII tables; no row enumeration, no broad SELECT, no raw proof body exposure. Validate `pg_roles`, grants, function PUBLIC execute defaults, search_path and ownership.
- Positive scoped QA HTTP E2E with synthetic product and order: legal preview, accepts, stock reservation, failure rollback, idempotent same-key replay, different-fingerprint conflict, missing/expired/stale legal token, no real payment or notifications.
- Verify legal source row locks and `lock_checkout_products` from real scoped role, mutation guard, trigger/hash constraints, rate-limit permissions and no privacy regressions.
- Only after QA pass and separate approval apply migration to Preview; Production later needs its own review, backups/recovery and gated rollout.
- Current decision **NO-GO** for Production.
