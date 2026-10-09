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
  return url;
}

/** Never silently fall back to the legacy owner connection. */
export function resolveScopedDatabaseUrl(scope: DatabaseScope, env: DatabaseEnv): string {
  if (scope !== "storefront" && scope !== "admin") throw new Error("Invalid database access scope.");
  const storefront = env.STOREFRONT_DATABASE_URL;
  const admin = env.ADMIN_DATABASE_URL;
  if (!storefront || !admin) throw new Error("Both scoped database connections must be configured before activation.");

  const storefrontUrl = parsePostgresUrl(storefront, "STOREFRONT_DATABASE_URL");
  const adminUrl = parsePostgresUrl(admin, "ADMIN_DATABASE_URL");
  if (storefrontUrl.username === adminUrl.username) {
    throw new Error("Storefront and admin database connections must use different PostgreSQL roles.");
  }
  const legacy = env.DATABASE_URL;
  if (legacy) {
    const legacyUrl = parsePostgresUrl(legacy, "DATABASE_URL");
    if (storefrontUrl.username === legacyUrl.username || adminUrl.username === legacyUrl.username) {
      throw new Error("Scoped database connections cannot reuse the legacy database role.");
    }
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
