import type { ExpectedIdentity } from "./db-runtime-attestation.ts";

/**
 * Pre-connect guard for the database attestation: judges a scoped connection string against the expected Preview identity BEFORE any connection is opened,
 * so a URL that names the wrong endpoint, database or role is never dialled at all (lib/db-runtime-attestation.ts only sees the URL after a session exists).
 *
 * It reads the string the way the DRIVER does, because a guard that parses differently from `pg` guards nothing. The installed pg-connection-string
 * (2.14) copies EVERY query parameter into the connection config - `?host=` replaces the URL's host, `?user=` its user, `?ssl=0` switches TLS off, `?sslrootcert=`,
 * `?options=` and the rest change the session - so no parameter other than the two TLS ones below is accepted, each at most once. The host is accepted only in the
 * plain Neon form (letters, digits, dashes, dots): the driver percent-decodes the host, so anything with `%`, brackets, a trailing dot or a unix-socket form is
 * refused here instead of being interpreted twice. Percent-encoded role and database are decoded exactly as the driver does, then compared.
 *
 * Reasons are fixed codes; nothing derived from the URL is ever returned. Pure: no I/O, no environment.
 */
const NEON_HOST = /^(ep-[a-z0-9]+(?:-[a-z0-9]+)+?)(?:-pooler)?\.(?:[a-z0-9-]+\.)+neon\.tech$/;
const ALLOWED_PARAMETERS: Record<string, readonly string[]> = { sslmode: ["require", "verify-ca", "verify-full"], channel_binding: ["require", "prefer"] };

export const PRECONNECT_REASONS = ["url_invalid", "url_params_unsupported", "url_host_not_neon", "url_endpoint_mismatch", "url_database_unexpected", "url_role_unexpected"] as const;

/** The reasons this URL must not be dialled for the expected identity (empty = acceptable). Never throws. */
export function preConnectViolations(connectionString: string, expected: ExpectedIdentity): string[] {
  let url: URL;
  try { url = new URL(connectionString); } catch { return ["url_invalid"]; }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.username || !url.hostname || url.hash) return ["url_invalid"];
  const reasons: string[] = [];

  // Parameters: only the two TLS ones, each once, with an approved value. (`?` alone, an empty name, a decoded duplicate: refused.)
  const seen = new Set<string>();
  for (const [name, value] of url.searchParams) {
    if (seen.has(name) || !ALLOWED_PARAMETERS[name]?.includes(value)) { reasons.push("url_params_unsupported"); break; }
    seen.add(name);
  }
  if (url.search && seen.size === 0 && !reasons.length) reasons.push("url_params_unsupported");

  // Host: the plain Neon form only, and the endpoint must be the expected one (pooled and direct hosts are the same endpoint).
  const host = NEON_HOST.exec(url.hostname.toLowerCase());
  if (!host) reasons.push("url_host_not_neon");
  else if (host[1] !== expected.endpointId) reasons.push("url_endpoint_mismatch");

  // Role and database, decoded the way the driver decodes them (user: decodeURIComponent; database: decodeURI of the path after the slash, exactly as pg-connection-string does), then compared with the expectation.
  let role: string | null = null, database: string | null = null;
  try { role = decodeURIComponent(url.username); } catch { reasons.push("url_invalid"); }
  try { database = /^\/[^/]+$/.test(url.pathname) ? decodeURI(url.pathname.slice(1)) : null; } catch { reasons.push("url_invalid"); }
  if (role !== null && role !== expected.role) reasons.push("url_role_unexpected");
  if (database !== expected.database) reasons.push("url_database_unexpected");
  return [...new Set(reasons)];
}
