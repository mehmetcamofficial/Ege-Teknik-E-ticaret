-- H5-A OPERATOR SQL — NOT APPLIED ANYWHERE. Run only after migration 0022 exists in the target database, by a person, on purpose.
-- Purpose: let the scoped storefront login role (CHECKOUT_SCOPED_DB_ENABLED=true) queue order notifications.
-- Without this grant nothing breaks: the checkout enqueues inside a SAVEPOINT, the insert is refused, the order still commits and the
-- worker's sweep re-queues the order's notifications within 30 minutes.
-- Replace :storefront_role with the real role name of the environment. Never run against Production without the release approval.
GRANT INSERT ON TABLE public.notification_outbox TO :storefront_role;
-- Deliberately NOT granted: SELECT, UPDATE, DELETE. The storefront can queue a row; it cannot read or alter any notification.
-- The worker runs on DATABASE_URL (the owner/admin connection) and needs no extra grant.
