-- REVIEW DRAFT ONLY. NOT APPLIED TO PRODUCTION.
-- Target: neondb, after verifying the approved endpoint/branch outside SQL.
-- Requires an approved privileged Neon operator: tenant neondb_owner authority is NOT assumed.
-- Stop new backup sessions during the maintenance window; no secrets/passwords are changed here.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
DO $guard$
BEGIN
  IF current_database() <> 'neondb' THEN RAISE EXCEPTION 'Unexpected database'; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname=current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Approved privileged operator required for BYPASSRLS/REPLICATION and role membership changes';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='backup_reader') THEN RAISE EXCEPTION 'Backup role missing'; END IF;
  IF EXISTS (SELECT FROM pg_shdepend d JOIN pg_roles r ON r.oid=d.refobjid WHERE r.rolname='backup_reader' AND d.deptype='o') THEN
    RAISE EXCEPTION 'Unexpected backup role ownership; review before changing privileges';
  END IF;
  IF EXISTS (SELECT FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member WHERE m.rolname='backup_reader' AND r.rolname<>'neon_superuser') THEN
    RAISE EXCEPTION 'Unexpected direct membership; review the drift';
  END IF;
  IF EXISTS (SELECT FROM pg_stat_activity WHERE usename='backup_reader' AND pid<>pg_backend_pid()) THEN
    RAISE EXCEPTION 'Backup sessions must be quiesced before applying';
  END IF;
  IF EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle') AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'RLS requires a separately reviewed full-backup design; never allow a silently partial dump';
  END IF;
END $guard$;
SET LOCAL ROLE cloud_admin;
REVOKE neon_superuser FROM backup_reader;
RESET ROLE;
ALTER ROLE backup_reader LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
REVOKE CREATE, TEMPORARY ON DATABASE neondb FROM backup_reader;
GRANT CONNECT ON DATABASE neondb TO backup_reader;
-- Existing PUBLIC TEMP remains; this draft does not change privileges of other users.
GRANT USAGE ON SCHEMA public, drizzle TO backup_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public, drizzle TO backup_reader;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public, drizzle TO backup_reader;
-- Workflow dumps the entire database, including Drizzle's ledger and sequence state.
-- SELECT on sequences is sufficient for pg_dump; nextval/USAGE/UPDATE are not granted.
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public, drizzle GRANT SELECT ON TABLES TO backup_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public, drizzle GRANT SELECT ON SEQUENCES TO backup_reader;
DO $verify$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='backup_reader' AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit)) THEN RAISE EXCEPTION 'Elevated role attributes remain'; END IF;
  IF EXISTS (SELECT FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.member WHERE r.rolname='backup_reader') THEN RAISE EXCEPTION 'Direct role membership remains'; END IF;
  IF EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle') AND CASE WHEN c.relkind IN ('r','p','v','m','f') THEN (has_table_privilege('backup_reader',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege('backup_reader',c.oid,'INSERT,UPDATE,REFERENCES')) ELSE false END) THEN RAISE EXCEPTION 'Unexpected effective write privilege; no automatic broad revoke'; END IF;
  IF EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle') AND CASE WHEN c.relkind='S' THEN has_sequence_privilege('backup_reader',c.oid,'USAGE,UPDATE') ELSE false END) THEN RAISE EXCEPTION 'Unexpected sequence write privilege'; END IF;
  IF NOT has_schema_privilege('backup_reader','drizzle','USAGE') OR NOT has_table_privilege('backup_reader','drizzle.__drizzle_migrations','SELECT') THEN RAISE EXCEPTION 'Migration-ledger backup access missing'; END IF;
END $verify$;
COMMIT;
-- Accept only after a fresh pg_dump -> authenticated decrypt -> independent restore check.
-- Do not grant pg_read_all_data / pg_write_all_data / neon_superuser to "fix" a failed backup.
