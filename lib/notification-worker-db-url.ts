/** Dedicated notification-worker credential guard. Pure function; never logs credentials. */
export type NotificationWorkerEnv = Record<string, string | undefined>;

const ALLOWED_QUERY: Record<string, string[]> = { sslmode: ["require", "verify-ca", "verify-full"], channel_binding: ["require", "prefer"] };

function decoded(value: string, name: string): string {
  // PostgreSQL sees the DECODED user and database. "app%5Frole" and "app_role" are the same role, so compare decoded text.
  try { return decodeURIComponent(value); }
  catch { throw new Error(`${name} must be a PostgreSQL URL.`); }
}

function parseDbUrl(raw: string | undefined, name: string): URL {
  if (!raw) throw new Error(`${name} is required for notification worker.`);
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error(`${name} must be a PostgreSQL URL.`); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || url.pathname.length < 2) {
    throw new Error(`${name} must be a PostgreSQL URL.`);
  }
  // node-postgres lets query parameters OVERRIDE the URL: ?user=, ?password=, ?host=, ?port=, ?database= replace the parts this guard
  // compares, `options` carries session settings (-c ...), and ?sslmode=disable would drop TLS. A worker URL therefore may carry only
  // these two Neon-standard parameters with a TLS-preserving value; anything else (any case, any repeat) is rejected.
  if (url.searchParams.has("options")) throw new Error(`${name} must not carry connection options.`);
  for (const [key, value] of url.searchParams) {
    if (!(ALLOWED_QUERY[key] ?? []).includes(value)) throw new Error(`${name} must not carry connection parameters other than sslmode and channel_binding.`);
  }
  return url;
}

/** Treat Neon direct and pooler endpoints of one branch as the same endpoint (decoded, case-insensitive host). */
function endpoint(url: URL, name: string): string {
  const host = url.hostname.toLowerCase().replace(/^([^.]+)-pooler\./, "$1.");
  return `${host}:${url.port || "5432"}/${decoded(url.pathname.slice(1), name)}`;
}

/**
 * Reject missing credentials, role reuse and cross-branch endpoints before
 * creating a worker pool. This is a config guard, NOT a Neon branch attestation: the run-time identity check
 * (lib/notifications/worker-identity.ts) asks the database who the connection really is.
 */
export function resolveNotificationWorkerDatabaseUrl(env: NotificationWorkerEnv): string {
  const names = ["DATABASE_URL", "STOREFRONT_DATABASE_URL", "ADMIN_DATABASE_URL", "NOTIFICATION_WORKER_DATABASE_URL"] as const;
  const urls = names.map((name) => parseDbUrl(env[name], name));
  const [legacy] = urls;
  const roles = urls.map((url, i) => decoded(url.username, names[i]));
  if (new Set(roles).size !== urls.length) {
    throw new Error("Notification worker requires four distinct database roles.");
  }
  const expected = endpoint(legacy, names[0]);
  if (urls.some((url, i) => endpoint(url, names[i]) !== expected)) {
    throw new Error("Notification worker database endpoint mismatch.");
  }
  return env.NOTIFICATION_WORKER_DATABASE_URL!;
}
