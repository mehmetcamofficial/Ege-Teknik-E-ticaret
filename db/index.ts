import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { resolveScopedDatabaseUrl, scopedCheckoutEnabled, type DatabaseScope } from "../lib/db-access-scope";

const globalForDb = globalThis as unknown as {
  egeTeknikPool?: Pool;
  egeTeknikScopedPools?: Partial<Record<DatabaseScope, Pool>>;
};

function databaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is not configured.");
  return value;
}

function assertEnvironmentIsolation(){const appEnv=process.env.APP_ENV,branchId=process.env.NEON_BRANCH_ID;if(!appEnv||!branchId)throw new Error("APP_ENV and NEON_BRANCH_ID must be configured.");if(!["development","preview","production"].includes(appEnv))throw new Error("APP_ENV is invalid.");const expected=process.env[`EXPECTED_NEON_${appEnv.toUpperCase()}_BRANCH_ID`];if(!expected||expected!==branchId)throw new Error("Database environment guard rejected the configured Neon branch.")}

function createPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 10, idleTimeoutMillis: 20_000, connectionTimeoutMillis: 10_000, ssl: { rejectUnauthorized: true } });
}

/** Legacy connection, retained until every caller has been migrated and tested. */
export function getPool() {
  assertEnvironmentIsolation();
  if (!globalForDb.egeTeknikPool) globalForDb.egeTeknikPool = createPool(databaseUrl());
  return globalForDb.egeTeknikPool;
}

export function getDb() { return drizzle(getPool(), { schema }); }

/** Opt-in scoped connections. Never fall back to DATABASE_URL. */
export function getScopedPool(scope: DatabaseScope): Pool {
  assertEnvironmentIsolation();
  const connectionString = resolveScopedDatabaseUrl(scope, process.env);
  const pools = globalForDb.egeTeknikScopedPools ??= {};
  if (!pools[scope]) pools[scope] = createPool(connectionString);
  return pools[scope];
}

export function getStorefrontDb() { return drizzle(getScopedPool("storefront"), { schema }); }
export function getAdminDb() { return drizzle(getScopedPool("admin"), { schema }); }

/** Checkout-only canary. No caller is moved unless the flag is explicitly true. */
export function getCheckoutDb() {
  return scopedCheckoutEnabled(process.env.CHECKOUT_SCOPED_DB_ENABLED) ? getStorefrontDb() : getDb();
}
