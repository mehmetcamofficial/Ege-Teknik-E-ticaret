-- REVIEW DRAFT ONLY: emergency rollback to the captured 20.10.2026 unsafe baseline.
-- NOT the default response to a failed backup; prefer repairing a missing SELECT grant.
-- Requires separate security approval and the original grantor's privileges.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
DO $guard$
BEGIN
  IF current_database()<>'neondb' OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Approved privileged operator and verified database required';
  END IF;
  IF EXISTS (SELECT FROM pg_stat_activity WHERE usename='backup_reader' AND pid<>pg_backend_pid()) THEN RAISE EXCEPTION 'Quiesce backup sessions first'; END IF;
END $guard$;
-- Only newly added direct/default Drizzle grants are removed. Existing public SELECT/defaults remain.
REVOKE SELECT ON ALL TABLES IN SCHEMA drizzle FROM backup_reader;
REVOKE SELECT ON ALL SEQUENCES IN SCHEMA drizzle FROM backup_reader;
REVOKE USAGE ON SCHEMA drizzle FROM backup_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA drizzle REVOKE SELECT ON TABLES FROM backup_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA drizzle REVOKE SELECT ON SEQUENCES FROM backup_reader;
ALTER ROLE backup_reader LOGIN INHERIT NOSUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS;
SET LOCAL ROLE cloud_admin;
GRANT neon_superuser TO backup_reader WITH ADMIN FALSE, INHERIT TRUE, SET TRUE;
RESET ROLE;
COMMIT;
