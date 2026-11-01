-- PR #40 CANONICAL OPERATOR SQL for the scoped checkout storefront role -- NOT APPLIED ANYWHERE. Run only after migrations 0017, 0018 and 0019 exist in
-- the target database, by a person, on purpose, with the release approval for that environment (docs/preview-scoped-checkout-rollout-runbook.md, Phase 3).
--
-- This is the ONE reviewed source of the storefront grants. The disposable-PostgreSQL gates apply this very file (scripts/checkout-storefront-grants.mjs) and
-- scripts/test-checkout-acl-postgres.mjs proves the EFFECTIVE privileges equal the set below, exactly: nothing more, nothing less.
--
-- Usage:  psql -v ON_ERROR_STOP=1 -v storefront_role=<role name> -f checkout-storefront-grants-20261029.sql
-- The role must already exist as LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION, be distinct from the admin role, from
-- DATABASE_URL's owner role and from the notification worker role, and be a member of no other role. This file never creates or alters a role.
-- Reading is statement-per-line: every statement is one line ending in a semicolon (the test helper splits on that).
--
-- Deliberately NOT granted: SELECT on orders, customers, addresses, order_items, order_legal_acceptances (the replay reads them only through
-- public.checkout_replay_by_key, a SECURITY DEFINER function that discloses a row only for an exact idempotency key + request fingerprint); any UPDATE on
-- products or orders (the product row lock is public.lock_checkout_products); DELETE except on rate_limit_buckets; TRUNCATE, REFERENCES, TRIGGER; any
-- sequence, any other schema, CREATE anywhere; any grant to PUBLIC; WITH GRANT OPTION.
-- notification_outbox INSERT is a SEPARATE, optional grant (docs/ops/notification-outbox-grants-20261022.sql): without it the order still commits.
GRANT USAGE ON SCHEMA public TO :"storefront_role";
-- Pricing, stock, legal documents and rate limiting read these. Legal-document SELECT is the checkout's published-version lookup.
GRANT SELECT ON products, inventory, legal_documents, legal_document_versions, rate_limit_buckets TO :"storefront_role";
-- The order itself, its evidence and the rate-limit bucket are written here and nowhere else.
GRANT INSERT ON customers, addresses, orders, order_items, order_legal_acceptances, rate_limit_buckets TO :"storefront_role";
-- Stock reservation: exactly the four columns the checkout changes.
GRANT UPDATE (on_hand, reserved, version, updated_at) ON inventory TO :"storefront_role";
-- Rate-limit bucket maintenance: exactly its counters and window, plus purging of expired buckets.
GRANT UPDATE (count, window_started_at, expires_at) ON rate_limit_buckets TO :"storefront_role";
GRANT DELETE ON rate_limit_buckets TO :"storefront_role";
-- SELECT ... FOR SHARE on legal_documents needs UPDATE on at least one column; created_at is the least sensitive column and is never written.
GRANT UPDATE (created_at) ON legal_documents TO :"storefront_role";
-- The two SECURITY DEFINER entry points (0017 inventory/product lock, 0019 idempotent replay). PUBLIC has no EXECUTE on either.
GRANT EXECUTE ON FUNCTION public.lock_checkout_products(text[]) TO :"storefront_role";
GRANT EXECUTE ON FUNCTION public.checkout_replay_by_key(text,text) TO :"storefront_role";
