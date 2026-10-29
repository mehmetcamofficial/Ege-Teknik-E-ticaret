import { sql, type SQL } from "drizzle-orm";

/**
 * Run-time attestation of the notification worker connection. The URL guard (lib/notification-worker-db-url.ts) only compares
 * strings; this asks the database who the connection really is and refuses any identity that is more than a queue worker:
 * superuser / bypassrls / createrole / createdb / replication, any access to admin_users, CREATE on the database or on schema
 * public, SET ROLE memberships, or a session user that differs from the current user.
 */
export type WorkerIdentity = {
  role_name: string; session_name: string;
  rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean; rolcreatedb: boolean; rolreplication: boolean;
  touches_admin_users: boolean; create_in_database: boolean; create_in_public: boolean; set_role_memberships: number | string;
};

export const WORKER_IDENTITY_SQL = `
  SELECT current_user::text AS role_name, session_user::text AS session_name,
    r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolreplication,
    (has_any_column_privilege(current_user, 'public.admin_users', 'SELECT,INSERT,UPDATE,REFERENCES')
      OR has_table_privilege(current_user, 'public.admin_users', 'DELETE,TRUNCATE,TRIGGER')) AS touches_admin_users,
    has_database_privilege(current_user, current_database(), 'CREATE') AS create_in_database,
    has_schema_privilege(current_user, 'public', 'CREATE') AS create_in_public,
    (SELECT count(*) FROM pg_auth_members m WHERE m.member = r.oid AND m.set_option) AS set_role_memberships
  FROM pg_roles r WHERE r.rolname = current_user`;

/** Pure: the list of reasons this identity is NOT acceptable (empty = acceptable). Reasons are fixed strings, never values. */
export function workerIdentityViolations(row: WorkerIdentity | undefined): string[] {
  if (!row) return ["identity_unreadable"];
  const reasons: string[] = [];
  if (row.rolsuper) reasons.push("superuser");
  if (row.rolbypassrls) reasons.push("bypassrls");
  if (row.rolcreaterole) reasons.push("createrole");
  if (row.rolcreatedb) reasons.push("createdb");
  if (row.rolreplication) reasons.push("replication");
  if (row.touches_admin_users) reasons.push("admin_users_access");
  if (row.create_in_database) reasons.push("create_in_database");
  if (row.create_in_public) reasons.push("create_in_public");
  if (Number(row.set_role_memberships) > 0) reasons.push("set_role_membership");
  if (row.role_name !== row.session_name) reasons.push("role_switched");
  return reasons;
}

export class WorkerIdentityError extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) { super("Notification worker identity rejected."); this.name = "WorkerIdentityError"; this.reasons = reasons; }
}

/** Reads the identity of the connection behind `db` (a read-only SELECT on catalog views; no application table is touched). */
export async function readWorkerIdentity(db: { execute: (query: SQL) => Promise<{ rows: unknown[] }> }): Promise<WorkerIdentity | undefined> {
  return (await db.execute(sql.raw(WORKER_IDENTITY_SQL))).rows[0] as WorkerIdentity | undefined;
}

const attested = globalThis as unknown as { egeTeknikWorkerIdentityOk?: boolean };

/** Asks the database once per process; a failure is never cached as success. `run` returns the single identity row. */
export async function assertNotificationWorkerIdentity(run: () => Promise<WorkerIdentity | undefined>): Promise<void> {
  if (attested.egeTeknikWorkerIdentityOk) return;
  const reasons = workerIdentityViolations(await run());
  if (reasons.length) throw new WorkerIdentityError(reasons);
  attested.egeTeknikWorkerIdentityOk = true;
}
