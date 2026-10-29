/** Pure configuration guard; no credentials are logged or returned in errors. */
export type DatabaseScope = "storefront" | "admin";
type DatabaseEnv = Record<string, string | undefined>;

function parsePostgresUrl(value: string, key: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid PostgreSQL URL.`);
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.pathname || url.pathname === "/") {
    throw new Error(`${key} must be a valid PostgreSQL URL.`);
  }
  // Permit only explicitly approved TLS-related connection parameters.
  // Reject identity, endpoint, session overrides and duplicate parameters.
  const allowedParameters: Record<string, readonly string[]> = {
    sslmode: ["require", "verify-ca", "verify-full"],
    channel_binding: ["require", "prefer"],
  };
  const seen = new Set<string>();
  for (const [name, value] of url.searchParams) {
    if (seen.has(name) || !allowedParameters[name]?.includes(value)) {
      throw new Error(`${key} contains unsupported connection parameters.`);
    }
    seen.add(name);
  }
  if (url.search && seen.size === 0) {
    throw new Error(`${key} contains unsupported connection parameters.`);
  }
  return url;
}

/** Compare PostgreSQL roles after URL percent-decoding. */
function databaseRole(url: URL): string {
  try {
    return decodeURIComponent(url.username);
  } catch {
    throw new Error("Invalid PostgreSQL role encoding.");
  }
}

/** Direct and Neon -pooler endpoints for the same branch are equivalent. */
function databaseEndpoint(url: URL): string {
  const hostname = url.hostname.replace(/^([^.]+)-pooler\./, "$1.");
  const port = url.port || "5432";
  return `${hostname}:${port}${url.pathname}`;
}

/** Never silently fall back to the legacy owner connection. */
export function resolveScopedDatabaseUrl(scope: DatabaseScope, env: DatabaseEnv): string {
  if (scope !== "storefront" && scope !== "admin") throw new Error("Invalid database access scope.");
  const storefront = env.STOREFRONT_DATABASE_URL;
  const admin = env.ADMIN_DATABASE_URL;
  if (!storefront || !admin) throw new Error("Both scoped database connections must be configured before activation.");

  const storefrontUrl = parsePostgresUrl(storefront, "STOREFRONT_DATABASE_URL");
  const adminUrl = parsePostgresUrl(admin, "ADMIN_DATABASE_URL");
  if (databaseRole(storefrontUrl) === databaseRole(adminUrl)) {
    throw new Error("Storefront and admin database connections must use different PostgreSQL roles.");
  }
  const legacy = env.DATABASE_URL;
  if (!legacy) throw new Error("DATABASE_URL is required to verify scoped database branch isolation.");
  const legacyUrl = parsePostgresUrl(legacy, "DATABASE_URL");
  if (databaseRole(storefrontUrl) === databaseRole(legacyUrl) || databaseRole(adminUrl) === databaseRole(legacyUrl)) {
    throw new Error("Scoped database connections cannot reuse the legacy database role.");
  }
  const expected = databaseEndpoint(legacyUrl);
  if (databaseEndpoint(storefrontUrl) !== expected || databaseEndpoint(adminUrl) !== expected) {
    throw new Error("Scoped database endpoints must match the configured legacy database branch and name.");
  }
  return scope === "storefront" ? storefront : admin;
}

/**
 * Explicit checkout-only rollout gate. An absent or false flag preserves the
 * legacy connection; an enabled flag must use the scoped role (no fallback).
 */
export function scopedCheckoutEnabled(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  throw new Error("CHECKOUT_SCOPED_DB_ENABLED must be true or false.");
}
