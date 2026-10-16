# Checkout/Legal scoped QA ACL grant verification — 2026-10-12

Scope: **isolated QA only** Neon project `silent-waterfall-20869858`, branch `br-delicate-frost-awnf26nw`, DB `neondb`. No active Preview or Production modifications.

Audited `app/api/orders/route.ts`, `lib/checkout-authority.ts`, `lib/legal-db.ts`, `lib/rate-limit-db.ts`, migrations 0016–0018. QA-only role `ege_qa_storefront_login` received minimal *initial checkout flow* grants:
- SELECT: products (already granted), legal_documents (already granted), inventory, legal_document_versions, customers, addresses, orders, order_items, order_legal_acceptances, rate_limit_buckets.
- INSERT: customers, addresses, orders, order_items, order_legal_acceptances, rate_limit_buckets.
- Column UPDATE: inventory(on_hand,reserved,version,updated_at), rate_limit_buckets(count,window_started_at,expires_at), legal_documents(created_at) (row-lock only; trigger 0016 must prevent edits).
- DELETE: rate_limit_buckets (bounded expired key cleanup).
- EXECUTE: `public.lock_checkout_products(text[])`.
- No UPDATE on products or orders; no DELETE on order/customer/legal tables; no admin_users/admin_invites privileges.
- QA role created via direct SQL; password enabled by user via local trusted terminal. Prior real-login QA checks showed admin_users denied, products=88 and legal_documents=7.

Catalog checks verified above grants. Specifically inventory.on_hand UPDATE=true, inventory.reorder_level UPDATE=false; legal_documents.created_at UPDATE=true, legal_documents.slug UPDATE=false; lock_checkout_products EXECUTE=true; orders UPDATE=false, products UPDATE=false.

## Remaining blocking validation
1. **REAL LOGIN TEST REQUIRED** using storefront credential on QA endpoint: SELECT products/versions/orders, verify permission denied on admin_users, products UPDATE, orders UPDATE, legal_documents.slug UPDATE. Perform controlled legal guard attempt only within transaction that always ROLLBACKs and with zero durable changes.
2. Function calls against known non-existent IDs should fail closed but carefully avoid invoking mutation/locking with real customer data without an approved test plan.
3. End-to-end checkout request test must use QA-specific deployed runner and synthetic entities, preserve all pre-existing orders; validate rate limiter, legal token, product locking, stock and immutable legal evidence, idempotent replay.
4. **Privacy caveat**: full SELECT on orders/customers/addresses and accepted legal documents means storefront DB credential can read personal rows. These grants are required for existing direct SQL route flows but NOT sufficient proof of least-data-access; assess RLS, narrow SECURITY DEFINER functions or route segmentation before Production.
5. Admin scoped role remains incomplete: only admin_users SELECT on `ege_qa_admin_login`; do not enable getAdminDb() on live routes yet.
6. `CHECKOUT_SCOPED_DB_ENABLED` remains OFF; no Vercel changes; no Production deployment.

**Decision: QA grant-matrix PASS; real-login checkout negative tests PENDING; production NO-GO.**
