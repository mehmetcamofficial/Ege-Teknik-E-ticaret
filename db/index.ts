import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { resolveScopedDatabaseUrl, scopedCheckoutEnabled, type DatabaseScope } from "../lib/db-access-scope";
import { resolveNotificationWorkerDatabaseUrl } from "../lib/notification-worker-db-url";
import { scopedPoolSettings, type ScopedPoolSettings } from "../lib/db-pool-config";

const globalForDb = globalThis as unknown as {
  egeTeknikPool?: Pool;
  egeTeknikScopedPools?: Partial<Record<DatabaseScope, Pool>>;
  egeTeknikNotificationWorkerPool?: Pool;
};

function databaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is not configured.");
  return value;
}

function assertEnvironmentIsolation(){const appEnv=process.env.APP_ENV,branchId=process.env.NEON_BRANCH_ID;if(!appEnv||!branchId)throw new Error("APP_ENV and NEON_BRANCH_ID must be configured.");if(!["development","preview","production"].includes(appEnv))throw new Error("APP_ENV is invalid.");const expected=process.env[`EXPECTED_NEON_${appEnv.toUpperCase()}_BRANCH_ID`];if(!expected||expected!==branchId)throw new Error("Database environment guard rejected the configured Neon branch.")}

function createPool(connectionString: string, scoped?: ScopedPoolSettings): Pool {
  const target = new URL(connectionString);
  // Disposable CI/local PostgreSQL does not expose TLS. Only development
  // loopback databases with the dedicated sprintb prefix may opt out.
  // Preview and Production always require certificate verification.
  const disposableLocal = process.env.APP_ENV === "development"
    && ["127.0.0.1", "localhost", "::1"].includes(target.hostname)
    && target.pathname.slice(1).startsWith("sprintb");
  // `scoped` (getScopedPool only) carries the vetted URL and TLS option from lib/db-pool-config.ts; the legacy and worker pools pass none and are unchanged.
  return new Pool({ connectionString: scoped?.connectionString ?? connectionString, max: 10, idleTimeoutMillis: 20_000, connectionTimeoutMillis: 10_000,
    ssl: scoped ? scoped.ssl : disposableLocal ? false : { rejectUnauthorized: true } });
}

/** Legacy connection, retained until every caller has been migrated and tested. */
export function getPool() {
  assertEnvironmentIsolation();
  if (!globalForDb.egeTeknikPool) globalForDb.egeTeknikPool = createPool(databaseUrl());
  return globalForDb.egeTeknikPool;
}

export function getDb() { return drizzle(getPool(), { schema }); }

/**
 * Opt-in scoped connections. Never fall back to DATABASE_URL.
 * The settings are decided BEFORE a pool exists (lib/db-pool-config.ts): TLS verification is pinned (the URL's sslmode cannot override it) and, in Preview,
 * the URL must name the expected role, database and Neon endpoint of this scope. A rejected URL never opens a connection.
 */
export function getScopedPool(scope: DatabaseScope): Pool {
  assertEnvironmentIsolation();
  const connectionString = resolveScopedDatabaseUrl(scope, process.env);
  const pools = globalForDb.egeTeknikScopedPools ??= {};
  if (!pools[scope]) pools[scope] = createPool(connectionString, scopedPoolSettings(scope, connectionString, process.env));
  return pools[scope];
}

/** Dedicated outbox worker connection; never falls back to legacy/owner credentials. */
export function getNotificationWorkerDb() {
  assertEnvironmentIsolation();
  const url = resolveNotificationWorkerDatabaseUrl(process.env);
  if (!globalForDb.egeTeknikNotificationWorkerPool) {
    globalForDb.egeTeknikNotificationWorkerPool = createPool(url);
  }
  return drizzle(globalForDb.egeTeknikNotificationWorkerPool, { schema });
}

export function getStorefrontDb() { return drizzle(getScopedPool("storefront"), { schema }); }
export function getAdminDb() { return drizzle(getScopedPool("admin"), { schema }); }

/** Checkout-only canary. No caller is moved unless the flag is explicitly true. */
export function getCheckoutDb() {
  return scopedCheckoutEnabled(process.env.CHECKOUT_SCOPED_DB_ENABLED) ? getStorefrontDb() : getDb();
}
