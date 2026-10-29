/**
 * Run-time attestation of a SCOPED database connection (storefront / admin) in Preview.
 *
 * lib/db-access-scope.ts only compares connection strings. This asks the database who the session really is and compares the answer, fail
 * closed, with the identity the Preview deployment is supposed to have:
 *
 *   - current_user and session_user (from a real session): both must equal the expected role for the scope. A difference means SET ROLE /
 *     SET SESSION AUTHORIZATION or a proxy that maps users; either way the session is not the configured identity.
 *   - current_database(): must equal the expected Preview database.
 *   - the role and database in the connection URL must equal what the session reports (a pooler or proxy that silently rewrites them is refused).
 *   - the Neon endpoint: Neon does not document an SQL-visible endpoint id, so the endpoint is attested on the CLIENT side, from the host the
 *     connection actually dials (Neon routes the TLS connection by that name). Direct and `-pooler` hosts of one endpoint are equivalent.
 *
 * Expected identity (non-secret configuration, Preview only):
 *   APP_ENV=preview, EXPECTED_PREVIEW_STOREFRONT_DB_ROLE, EXPECTED_PREVIEW_ADMIN_DB_ROLE, EXPECTED_PREVIEW_DB_NAME, EXPECTED_NEON_PREVIEW_ENDPOINT_ID
 *
 * Nothing here logs. Errors and reasons are fixed strings: never a URL, host, role name, database name, password or driver message.
 */
export type AttestedScope = "storefront" | "admin";
type Env = Record<string, string | undefined>;
export type Query = (text: string) => Promise<{ rows: unknown[] }>;

export type ObservedIdentity = { role_name: string; session_name: string; database_name: string };
export type ExpectedIdentity = { role: string; database: string; endpointId: string };

/** The three facts come from the session itself; no application table is read. */
export const DATABASE_IDENTITY_SQL = "SELECT current_user::text AS role_name, session_user::text AS session_name, current_database()::text AS database_name";

/** Roles that are documented as never acceptable for a scoped application connection, whatever the configuration says. */
export const FORBIDDEN_ROLES: readonly string[] = ["postgres", "neondb_owner", "cloud_admin", "ege_teknik_preview_app", "ege_teknik_preview_runtime"];

const ROLE = /^[a-z_][a-z0-9_$]{0,62}$/;
const DATABASE = /^[A-Za-z0-9_-]{1,63}$/;
const ENDPOINT = /^ep-[a-z0-9]+(?:-[a-z0-9]+)+$/;

export class DatabaseRuntimeAttestationError extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) { super("Database runtime identity rejected."); this.name = "DatabaseRuntimeAttestationError"; this.reasons = reasons; }
}

/** Pure: the expected identity for a scope, or the configuration problems (fixed strings naming variables, never their values). */
export function expectedIdentity(scope: AttestedScope, env: Env): { ok: true; expected: ExpectedIdentity } | { ok: false; reasons: string[] } {
  if (scope !== "storefront" && scope !== "admin") return { ok: false, reasons: ["invalid_scope"] };
  const reasons: string[] = [];
  if (env.APP_ENV !== "preview") reasons.push("not_preview");
  const storefront = env.EXPECTED_PREVIEW_STOREFRONT_DB_ROLE?.trim() ?? "", admin = env.EXPECTED_PREVIEW_ADMIN_DB_ROLE?.trim() ?? "";
  const database = env.EXPECTED_PREVIEW_DB_NAME?.trim() ?? "", endpointId = env.EXPECTED_NEON_PREVIEW_ENDPOINT_ID?.trim() ?? "";
  if (!ROLE.test(storefront)) reasons.push("EXPECTED_PREVIEW_STOREFRONT_DB_ROLE_invalid");
  if (!ROLE.test(admin)) reasons.push("EXPECTED_PREVIEW_ADMIN_DB_ROLE_invalid");
  if (storefront && storefront === admin) reasons.push("expected_roles_not_distinct");
  if ([storefront, admin].some((r) => FORBIDDEN_ROLES.includes(r))) reasons.push("expected_role_forbidden");
  if (!DATABASE.test(database)) reasons.push("EXPECTED_PREVIEW_DB_NAME_invalid");
  if (!ENDPOINT.test(endpointId)) reasons.push("EXPECTED_NEON_PREVIEW_ENDPOINT_ID_invalid");
  return reasons.length ? { ok: false, reasons } : { ok: true, expected: { role: scope === "storefront" ? storefront : admin, database, endpointId } };
}

/** Pure: what the connection URL says about the session it opens (role, database, Neon endpoint), or null when it cannot be read. */
export function connectionTarget(connectionString: string): { role: string; database: string; endpointId: string | null } | null {
  let url: URL;
  try { url = new URL(connectionString); } catch { return null; }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.username || url.pathname.length < 2) return null;
  let role: string, database: string;
  try { role = decodeURIComponent(url.username); database = decodeURIComponent(url.pathname.slice(1)); } catch { return null; }
  const host = url.hostname.toLowerCase();
  const neon = /^(ep-[a-z0-9-]+?)(?:-pooler)?\.(?:[a-z0-9-]+\.)+neon\.tech$/.exec(host);
  return { role, database, endpointId: neon ? neon[1] : null };
}

/** Pure: every reason the observed session is NOT the expected identity (empty = accepted). */
export function databaseRuntimeViolations(observed: unknown, expected: ExpectedIdentity, connectionString: string): string[] {
  const o = observed as Partial<ObservedIdentity> | undefined;
  if (!o || typeof o.role_name !== "string" || typeof o.session_name !== "string" || typeof o.database_name !== "string") return ["identity_unreadable"];
  const reasons: string[] = [];
  if (o.role_name !== o.session_name) reasons.push("role_switched");
  if (FORBIDDEN_ROLES.includes(o.role_name) || FORBIDDEN_ROLES.includes(o.session_name)) reasons.push("forbidden_role");
  if (o.session_name !== expected.role || o.role_name !== expected.role) reasons.push("role_mismatch");
  if (o.database_name !== expected.database) reasons.push("database_mismatch");
  const target = connectionTarget(connectionString);
  if (!target) reasons.push("url_invalid");
  else {
    if (target.role !== o.session_name) reasons.push("url_role_mismatch");
    if (target.database !== o.database_name) reasons.push("url_database_mismatch");
    if (target.endpointId === null) reasons.push("endpoint_not_neon");
    else if (target.endpointId !== expected.endpointId) reasons.push("endpoint_mismatch");
  }
  return reasons;
}

/** Reads the identity of a real session. Any driver failure becomes a fixed reason (the driver message may contain a host or a role). */
export async function readDatabaseIdentity(query: Query, timeoutMs = 5000): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DatabaseRuntimeAttestationError(["identity_timeout"])), timeoutMs); });
  try {
    const result = await Promise.race([query(DATABASE_IDENTITY_SQL), timeout]);
    return Array.isArray(result?.rows) && result.rows.length === 1 ? result.rows[0] : undefined;
  } catch (error) {
    if (error instanceof DatabaseRuntimeAttestationError) throw error;
    throw new DatabaseRuntimeAttestationError(["identity_query_failed"]);
  } finally { if (timer) clearTimeout(timer); }
}

/**
 * Attests one scoped connection. Throws DatabaseRuntimeAttestationError (fixed reasons) unless configuration, session and endpoint all match.
 * The configuration is checked BEFORE the database is asked, so a misconfigured deployment never opens a session for this purpose.
 */
export async function attestDatabaseRuntime(input: { scope: AttestedScope; connectionString: string; env: Env; query: Query; timeoutMs?: number }): Promise<ExpectedIdentity> {
  const config = expectedIdentity(input.scope, input.env);
  if (!config.ok) throw new DatabaseRuntimeAttestationError(config.reasons);
  const observed = await readDatabaseIdentity(input.query, input.timeoutMs);
  const reasons = databaseRuntimeViolations(observed, config.expected, input.connectionString);
  if (reasons.length) throw new DatabaseRuntimeAttestationError(reasons);
  return config.expected;
}
