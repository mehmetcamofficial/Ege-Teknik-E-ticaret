-- PR #37 OPERATOR SQL - NOT APPLIED ANYWHERE. Run only after migration 0022 exists in the target database, by a person, on purpose.
-- Purpose: create the dedicated notification-worker identity used by /api/internal/notifications/dispatch (NOTIFICATION_WORKER_DATABASE_URL).
-- The worker must never run on the owner/legacy, storefront or admin connection, and it must never read admin_users.
--
-- Placeholders (replace them; no psql meta-commands are used so a QA harness can substitute them textually):
--   :"dbname"           target database name           :"worker_role"   NOLOGIN group role that owns the grants
--   :"worker_login"     LOGIN role used in the URL     :'worker_password' strong random password for the LOGIN role (never commit it)
-- Never run against Production without the release approval and a Neon snapshot/branch taken first.
-- ORDER: migration 0024_notification_claim_token FIRST (this file references notification_outbox.claim_token; without it the file fails atomically with 42703),
-- then this file, then the worker code. Rollback of the column: see the header of drizzle-pg/0024_notification_claim_token.sql.
-- RE-RUNNABILITY: this file is deliberately NOT idempotent. It is one transaction and CREATE ROLE has no IF NOT EXISTS, so a second run
-- fails at the first statement and rolls back completely (nothing is half-applied). To re-apply, run the ROLLBACK block at the bottom first.
-- The password must not appear on a command line (process lists show it): put `\set worker_password` + the value in a private 0600 file that
-- you `\i` first, or substitute it inside a trusted wrapper. Do not paste this file's resulting statements into tickets or chat.
--
-- Least privilege. The ONLY things the worker can do:
--   orders        NOTHING on the table itself (no table or column grant of any kind). It reads orders ONLY through the view
--                 public.notification_orders (below): 14 plain columns the e-mail templates and the sweep need, plus two values extracted
--                 from the shipping snapshot - the district and the delivery method. The snapshot itself (it also holds the customer's
--                 phone number and street address), phone, address, notes, billing snapshot, request fingerprint, idempotency key and
--                 the payment/legal evidence columns are NOT reachable through any path.
--   order_items   SELECT 5 columns (order_id, product_name, quantity, unit_price, line_total)
--   notification_outbox  SELECT its own queue columns, INSERT 4 columns (sweep), UPDATE 8 state columns (claim/retry/dead/sent). claim_token (migration 0024, R-03)
--                 is the per-claim fencing token: it holds no personal data and is the only column added for it; without it a worker whose lease
--                 expired could overwrite the result of the worker that re-claimed the row.
--   audit_logs    INSERT 7 columns (request_id, ip_hash and created_at keep their defaults)
-- Deliberately NOT granted: anything on admin_users and every other table, DELETE/TRUNCATE/TRIGGER/REFERENCES anywhere, UPDATE of
-- any other column, CREATE on any schema, USAGE on the drizzle schema, EXECUTE on any application function.
-- Why a view (R-01 of the PR #38 security review): a column-level GRANT cannot restrict the KEYS inside a jsonb column, so granting SELECT on
-- orders.shipping_address_snapshot exposed phone and street address of every order. The view is created WITH (security_invoker = false), i.e.
-- it reads orders with its OWNER's rights (the operator running this file, never the worker), so the worker needs no privilege on orders at
-- all; security_barrier = true stops a user-supplied function from being pushed below the view; the view has no INSERT/UPDATE/DELETE grant
-- for anyone but its owner and every reference inside it is schema-qualified and resolved when it is created, so the worker's search_path
-- cannot redirect it. Orders created before this change need no backfill: the values are extracted from the stored snapshot on read.
-- Known residual: PostgreSQL grants TEMPORARY on every database and USAGE on schema public to PUBLIC by default; this file does not
-- change PUBLIC defaults (that would affect other roles). Review it before enabling the worker in Production.

BEGIN;

CREATE ROLE :"worker_role" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE :"worker_login" LOGIN PASSWORD :'worker_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 10;
-- The LOGIN role inherits the privileges but can never SET ROLE to the group role or to anything else.
GRANT :"worker_role" TO :"worker_login" WITH INHERIT TRUE, SET FALSE;
-- Bound every statement so a stuck lock or runaway query surfaces as an error (57014 / 55P03 / 25P03) instead of a silent hang.
ALTER ROLE :"worker_login" SET statement_timeout = '30s';
ALTER ROLE :"worker_login" SET lock_timeout = '10s';
ALTER ROLE :"worker_login" SET idle_in_transaction_session_timeout = '30s';

GRANT CONNECT ON DATABASE :"dbname" TO :"worker_role";
GRANT USAGE ON SCHEMA public TO :"worker_role";

CREATE VIEW public.notification_orders WITH (security_barrier = true, security_invoker = false) AS
  SELECT o.id, o.order_number, o.created_at, o.subtotal, o.vat_total, o.shipping_total, o.installation_total, o.total,
         o.customer_name, o.email, o.installation_preference, o.city, o.payment_status, o.status,
         o.shipping_address_snapshot ->> 'district' AS district,
         o.shipping_address_snapshot -> 'delivery' ->> 'method' AS delivery_method
  FROM public.orders AS o;
REVOKE ALL ON public.notification_orders FROM PUBLIC;
GRANT SELECT ON public.notification_orders TO :"worker_role";
GRANT SELECT (order_id, product_name, quantity, unit_price, line_total) ON public.order_items TO :"worker_role";

GRANT SELECT (id, kind, order_id, dedupe_key, status, attempts, next_attempt_at, last_attempt_at, locked_until, claim_token, last_error_code, sent_at, created_at)
  ON public.notification_outbox TO :"worker_role";
GRANT INSERT (id, kind, order_id, dedupe_key) ON public.notification_outbox TO :"worker_role";
GRANT UPDATE (status, attempts, last_attempt_at, next_attempt_at, locked_until, claim_token, last_error_code, sent_at) ON public.notification_outbox TO :"worker_role";

GRANT INSERT (id, actor_user_id, actor_email, action, entity_type, entity_id, payload) ON public.audit_logs TO :"worker_role";

COMMIT;

-- Storefront (separate, unchanged by this file): it may only queue a row at checkout, inside a SAVEPOINT, so a refusal never blocks an order:
--   GRANT INSERT ON TABLE public.notification_outbox TO :storefront_role;   -- see docs/ops/notification-outbox-grants-20261022.sql

-- ROLLBACK (operator, same placeholders; a person runs it on purpose). First stop the caller: unset NOTIFICATION_DISPATCH_SECRET (the route
-- then answers 404) and/or remove NOTIFICATION_WORKER_DATABASE_URL (503), then end any open worker sessions
-- (SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '<worker_login>'), then:
--   BEGIN;
--   DROP VIEW public.notification_orders;   -- owned by the operator, not by the worker: it must be dropped explicitly
--   DROP OWNED BY :"worker_login";   -- removes its role-level settings
--   DROP OWNED BY :"worker_role";    -- revokes every grant listed above in this database
--   DROP ROLE :"worker_login";
--   DROP ROLE :"worker_role";
--   COMMIT;
-- Outbox rows already queued stay in notification_outbox and are picked up again once a worker is re-enabled.
