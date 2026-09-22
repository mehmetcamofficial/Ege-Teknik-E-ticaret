import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { egeTeknikPool?: Pool };

function databaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is not configured.");
  return value;
}

function assertEnvironmentIsolation(){const appEnv=process.env.APP_ENV,branchId=process.env.NEON_BRANCH_ID;if(!appEnv||!branchId)throw new Error("APP_ENV and NEON_BRANCH_ID must be configured.");if(!["development","preview","production"].includes(appEnv))throw new Error("APP_ENV is invalid.");const expected=process.env[`EXPECTED_NEON_${appEnv.toUpperCase()}_BRANCH_ID`];if(!expected||expected!==branchId)throw new Error("Database environment guard rejected the configured Neon branch.")}

export function getPool() {
  assertEnvironmentIsolation();
  if (!globalForDb.egeTeknikPool) globalForDb.egeTeknikPool = new Pool({ connectionString:databaseUrl(), max:10, idleTimeoutMillis:20_000, connectionTimeoutMillis:10_000,ssl:{rejectUnauthorized:true} });
  return globalForDb.egeTeknikPool;
}

export function getDb() { return drizzle(getPool(), { schema }); }
