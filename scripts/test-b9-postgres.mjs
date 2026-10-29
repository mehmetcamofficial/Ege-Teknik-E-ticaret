#!/usr/bin/env node
/**
 * B9 (AI budget) - real-PostgreSQL gate for tests/ai-budget-db-b9.test.ts.
 *
 * Why a wrapper exists: the test file is OPT-IN (without B9_TEST_DATABASE_URL it reports "skipped"), and it used to demand the fixed
 * address 127.0.0.1:55489, so no CI command ever ran it. A skip is not a verification. This runner therefore:
 *
 *   1. refuses unless CI=true and B9_PG_URL is a loopback PostgreSQL URL that is not the recovery port (55432);
 *   2. proves the CLUSTER is disposable with scripts/disposable-cluster-attest.mjs (the same proof as the worker suites: no foreign
 *      database, not a hosted compute, and either the local lab cluster or a CI service container marked by this very run);
 *   3. creates its OWN new database (B9_PG_DB, default sprintb_b9_ci - the test requires the sprintb_b9 prefix), migrates it with the
 *      reviewed bootstrap, and REFUSES if that database already exists (the bootstrap resets schemas, so it must never touch one);
 *   4. runs only that test file with a minimal environment (no CI/GitHub variables, no other credentials) and fails unless exactly
 *      one test ran and passed (fail, cancelled or skipped !== 0, or tests !== 1, all fail the gate);
 *   5. drops the database it created - and nothing else. No role is created, so no role is dropped.
 *
 * It never prints the connection URL. Run via `pnpm test:b9-postgres`.
 * env: B9_PG_URL (host and credentials of the disposable cluster; its database part only supplies the login), B9_PG_DB (optional).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { attestDisposableCluster } from "./disposable-cluster-attest.mjs";
import { bootstrapDisposableDatabase, defaultStageDeps } from "./disposable-postgres-bootstrap.mjs";

const TEST_FILE = "tests/ai-budget-db-b9.test.ts";
const EXPECTED_TESTS = 1;
const DB_NAME = /^sprintb_b9[a-z0-9_]{0,30}$/;
const LOOPBACK = ["127.0.0.1", "localhost", "::1"];

const refuse = (why) => { console.error(`[b9-postgres] REFUSED: ${why}`); process.exit(1); };
const fail = (why) => { console.error(`[b9-postgres] FAIL: ${why}`); process.exitCode = 1; };
const redact = (text) => text.replace(/postgres(?:ql)?:\/\/[^\s"']+/g, "[redacted]");

const base = (() => { try { return new URL(process.env.B9_PG_URL ?? ""); } catch { return null; } })();
const DB = process.env.B9_PG_DB ?? "sprintb_b9_ci";
if (process.env.CI !== "true") refuse("requires CI=true");
if (!base || !["postgres:", "postgresql:"].includes(base.protocol)) refuse("B9_PG_URL must be a PostgreSQL URL");
if (!LOOPBACK.includes(base.hostname.replace(/^\[|\]$/g, ""))) refuse("loopback PostgreSQL URL required");
if (base.port === "55432") refuse("the recovery cluster port is never allowed");
if (!DB_NAME.test(DB)) refuse("B9_PG_DB must be a new sprintb_b9* database name");

const urlFor = (database) => { const u = new URL(base); u.pathname = `/${database}`; return u.toString(); };
const maintenance = new pg.Pool({ connectionString: urlFor("postgres"), max: 1 });
let createdDatabase = false;   // cleanup may only remove what THIS run created: a refused (pre-existing) database must survive untouched

try {
  const route = await attestDisposableCluster({ url: urlFor("postgres"), query: (text, params) => maintenance.query(text, params), env: process.env });
  console.log(`[b9-postgres] disposable cluster attested (${route} route)`);
  if ((await maintenance.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB])).rowCount !== 0) throw new Error("database already exists: refusing to reuse or reset it");
  await maintenance.query(`CREATE DATABASE "${DB}"`);
  createdDatabase = true;
  const journal = JSON.parse(readFileSync("drizzle-pg/meta/_journal.json", "utf8"));
  await bootstrapDisposableDatabase({ Pool: pg.Pool, drizzle, migrate, url: urlFor(DB), journal, migrationsFolder: "drizzle-pg", ...defaultStageDeps, log: () => {} });

  // Only what the test needs: no CI / GitHub variables, no cluster attestation marker, no other credentials.
  const childEnv = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", B9_TEST_DATABASE_URL: urlFor(DB) };
  const run = spawnSync(process.execPath, ["--test", "--experimental-strip-types", "--test-reporter=tap", TEST_FILE], { env: childEnv, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
  process.stdout.write(redact(run.stdout ?? ""));
  if (run.stderr) process.stderr.write(redact(run.stderr));
  if (run.error) throw new Error(`test process did not start: ${run.error.message}`);

  const counters = {};
  for (const match of (run.stdout ?? "").matchAll(/^(?:#|ℹ)\s+(tests|suites|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$/gm)) counters[match[1]] = Number(match[2]);
  if (typeof counters.tests !== "number" || typeof counters.pass !== "number") throw new Error("could not read the TAP summary - the run did not report results");
  console.log(`[b9-postgres] tests=${counters.tests} pass=${counters.pass} fail=${counters.fail ?? 0} skipped=${counters.skipped ?? 0} cancelled=${counters.cancelled ?? 0}`);
  if (run.status !== 0 || (counters.fail ?? 1) !== 0 || (counters.cancelled ?? 1) !== 0) throw new Error("the B9 test failed on real PostgreSQL");
  if ((counters.skipped ?? 1) !== 0) throw new Error(`${counters.skipped} test(s) were SKIPPED. Skipped is not verified: this gate requires a real PostgreSQL run`);
  if (counters.tests !== EXPECTED_TESTS || counters.pass !== EXPECTED_TESTS) throw new Error(`expected exactly ${EXPECTED_TESTS} executed test, saw pass=${counters.pass} of tests=${counters.tests}`);
  console.log(`[b9-postgres] OK: ${EXPECTED_TESTS} test executed against real PostgreSQL, 0 skipped.`);
} catch (error) {
  fail(redact(error instanceof Error ? error.message : String(error)).slice(0, 600));
} finally {
  if (!createdDatabase) console.log("[b9-postgres] cleanup: nothing was created by this run, nothing is dropped");
  else try {
    await maintenance.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    console.log("[b9-postgres] cleanup: scratch database dropped");
  } catch (error) { fail(`cleanup incomplete: ${redact(error instanceof Error ? error.message : String(error)).slice(0, 200)}`); }
  await maintenance.end().catch(() => {});
}
