-- PR #37 OPERATOR SQL - NOT APPLIED ANYWHERE. Run only after migration 0022 exists in the target database, by a person, on purpose.
-- Purpose: create the dedicated notification-worker identity used by /api/internal/notifications/dispatch (NOTIFICATION_WORKER_DATABASE_URL).
-- The worker must never run on the owner/legacy, storefront or admin connection, and it must never read admin_users.
--
-- Placeholders (replace them; no psql meta-commands are used so a QA harness can substitute them textually):
--   :"dbname"           target database name           :"worker_role"   NOLOGIN group role that owns the grants
--   :"worker_login"     LOGIN role used in the URL     :'worker_password' strong random password for the LOGIN role (never commit it)
-- Never run against Production without the release approval and a Neon snapshot/branch taken first.
-- RE-RUNNABILITY: this file is deliberately NOT idempotent. It is one transaction and CREATE ROLE has no IF NOT EXISTS, so a second run
-- fails at the first statement and rolls back completely (nothing is half-applied). To re-apply, run the ROLLBACK block at the bottom first.
-- The password must not appear on a command line (process lists show it): put `\set worker_password` + the value in a private 0600 file that
-- you `\i` first, or substitute it inside a trusted wrapper. Do not paste this file's resulting statements into tickets or chat.
--
-- Least privilege, column level. The ONLY things the worker can do:
--   orders        SELECT 15 columns the e-mail templates and the sweep need (no phone, street address, notes, billing snapshot,
--                 request fingerprint, idempotency key, payment/legal evidence columns)
--   order_items   SELECT 5 columns (order_id, product_name, quantity, unit_price, line_total)
--   notification_outbox  SELECT its own queue columns, INSERT 4 columns (sweep), UPDATE 7 state columns (claim/retry/dead/sent)
--   audit_logs    INSERT 7 columns (request_id, ip_hash and created_at keep their defaults)
-- Deliberately NOT granted: anything on admin_users and every other table, DELETE/TRUNCATE/TRIGGER/REFERENCES anywhere, UPDATE of
-- any other column, CREATE on any schema, USAGE on the drizzle schema, EXECUTE on any application function.
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

GRANT SELECT (id, order_number, created_at, subtotal, vat_total, shipping_total, installation_total, total, customer_name, email,
              shipping_address_snapshot, installation_preference, city, payment_status, status)
  ON public.orders TO :"worker_role";
GRANT SELECT (order_id, product_name, quantity, unit_price, line_total) ON public.order_items TO :"worker_role";

GRANT SELECT (id, kind, order_id, dedupe_key, status, attempts, next_attempt_at, last_attempt_at, locked_until, last_error_code, sent_at, created_at)
  ON public.notification_outbox TO :"worker_role";
GRANT INSERT (id, kind, order_id, dedupe_key) ON public.notification_outbox TO :"worker_role";
GRANT UPDATE (status, attempts, last_attempt_at, next_attempt_at, locked_until, last_error_code, sent_at) ON public.notification_outbox TO :"worker_role";

GRANT INSERT (id, actor_user_id, actor_email, action, entity_type, entity_id, payload) ON public.audit_logs TO :"worker_role";

COMMIT;

-- Storefront (separate, unchanged by this file): it may only queue a row at checkout, inside a SAVEPOINT, so a refusal never blocks an order:
--   GRANT INSERT ON TABLE public.notification_outbox TO :storefront_role;   -- see docs/ops/notification-outbox-grants-20261022.sql

-- ROLLBACK (operator, same placeholders; a person runs it on purpose). First stop the caller: unset NOTIFICATION_DISPATCH_SECRET (the route
-- then answers 404) and/or remove NOTIFICATION_WORKER_DATABASE_URL (503), then end any open worker sessions
-- (SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '<worker_login>'), then:
--   BEGIN;
--   DROP OWNED BY :"worker_login";   -- removes its role-level settings
--   DROP OWNED BY :"worker_role";    -- revokes every grant listed above in this database
--   DROP ROLE :"worker_login";
--   DROP ROLE :"worker_role";
--   COMMIT;
-- Outbox rows already queued stay in notification_outbox and are picked up again once a worker is re-enabled.
