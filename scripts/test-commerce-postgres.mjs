#!/usr/bin/env node
/**
 * Commerce persistence gate: runs the real-PostgreSQL suites that are opt-in behind
 * FINANCE_TEST_DATABASE_URL (payments/ledger, orders, blog, service requests) and that the hermetic
 * `pnpm test` therefore SKIPS. A skip is not a verification, so this runner refuses to report success
 * unless every one of those tests actually RAN and PASSED.
 *
 * Why a wrapper exists (same reason as scripts/test-postgres-integration.mjs): without the database
 * variable every one of these tests reports "skipped", which is correct for local `pnpm test` but must
 * never be accepted as "PostgreSQL verification passed". This runner:
 *
 *   1. fails closed unless COMMERCE_PG_URL is set, and accepts ONLY a loopback database whose name
 *      starts with "sprintb" (the disposable CI service container's own database). Any other target -
 *      a remote/hosted database, a developer machine's local database - is refused before a socket is
 *      opened, so no credential is ever used against a database it does not own;
 *   2. fails if any allow-listed suite file is missing (an accidental omission must not look green);
 *   3. before EACH suite, resets and re-migrates the database through the repository's own migration
 *      mechanism (drizzle-orm's migrator over drizzle-pg/), reproducing the reviewed history migration
 *      0011 requires - 0000-0010, then the single legacy owner, then 0011..head - exactly as
 *      tests/sprint-b-postgres.integration.test.ts already does (see scripts/disposable-postgres-bootstrap.mjs);
 *   4. runs the suites one at a time and fails unless exit status, fail, cancelled and skipped are all
 *      zero, pass equals tests, and the aggregate reaches EXPECTED_MIN_TESTS.
 *
 * ISOLATION (why the schema is reset per suite, not per run): these suites assert over the WHOLE table,
 * not only their own rows - tests/orders-db.test.ts expects its newest order to be row 1 of the
 * newest-first page, tests/paytr-db.test.ts compares a global payments count before/after, and the
 * pagination suites assert global page counts. tests/finance-db.test.ts deliberately picks a RANDOM year
 * (2001-2020) while orders-db uses 2005, so sharing one schema would make the newest-first assertion
 * depend on a coin flip. One clean, fully migrated schema per suite removes the ordering question
 * entirely: correctness over CI speed.
 *
 * FINANCE_TEST_DATABASE_URL is never read from this process's own environment and is never printed:
 * the suites receive it through the child environment only. The connection string is never logged.
 *
 * Run via `pnpm test:commerce-postgres`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { BootstrapError, bootstrapDisposableDatabase, defaultStageDeps } from "./disposable-postgres-bootstrap.mjs";

/** Every test file in tests/ that opts into FINANCE_TEST_DATABASE_URL. tests/ci-commerce-postgres.test.ts fails if this drifts. */
const TEST_FILES = [
  "tests/paytr-db.test.ts",
  "tests/finance-db.test.ts",
  "tests/orders-db.test.ts",
  "tests/blog-db.test.ts",
  "tests/service-requests-db.test.ts",
];
/** How many of those tests need the database (the other tests in the same files are hermetic). Floor, not an exact count. */
const EXPECTED_MIN_TESTS = 31;
/** The runner's own input. Deliberately not named *_DATABASE_URL: tests/ci-workflow-policy.test.ts forbids that token in the workflow. */
const ENV_NAME = "COMMERCE_PG_URL";
/** What the suites themselves read. Supplied to the child process only. */
const CHILD_ENV_NAME = "FINANCE_TEST_DATABASE_URL";
const MIGRATIONS_FOLDER = "drizzle-pg";
const LOOPBACK = ["127.0.0.1", "localhost", "::1"];

function fail(message) {
  console.error(`[commerce-postgres] FAIL: ${message}`);
  process.exit(1);
}

/** A URL or null. Parsing never echoes the value, which can carry credentials. */
function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** A printable summary that can never contain the connection string, a host, a user or a password. */
function safeErrorSummary(error) {
  if (error instanceof BootstrapError) return error.message;
  const code = typeof error?.code === "string" ? error.code : error?.name ?? "Error";
  if (typeof error?.severity === "string" && typeof error?.message === "string") return `${code}: ${error.message.slice(0, 200)}`;
  return String(code);
}

function readTAPCounters(stdout) {
  const counters = {};
  for (const match of (stdout ?? "").matchAll(/^(?:#|ℹ)\s+(tests|suites|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$/gm)) {
    counters[match[1]] = Number(match[2]);
  }
  return counters;
}

async function main() {
  const url = process.env[ENV_NAME];
  if (!url) {
    fail(
      `${ENV_NAME} is not set. Point it at a disposable loopback PostgreSQL database whose name starts with "sprintb" ` +
        "(the CI service container's own database). Without it these commerce suites only SKIP - a skip is not a verification.",
    );
  }
  const target = parseUrl(url);
  if (!target) {
    fail(`${ENV_NAME} is not a valid connection URL.`);
  }
  if (!LOOPBACK.includes(target.hostname)) {
    fail(`${ENV_NAME} must point at a loopback PostgreSQL instance (127.0.0.1, localhost or ::1).`);
  }
  if (!target.pathname.slice(1).startsWith("sprintb")) {
    fail('the commerce test database name must start with "sprintb" (this runner drops and recreates its schemas).');
  }
  for (const file of TEST_FILES) {
    if (!existsSync(file)) fail(`expected suite ${file} is missing; the allow-list must only name committed test files.`);
  }

  const journal = JSON.parse(readFileSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`, "utf8"));
  const totals = { tests: 0, pass: 0, fail: 0, skipped: 0, cancelled: 0 };
  for (const file of TEST_FILES) {
    try {
      // Fail-closed setup: a reset, the reviewed pre-0011 bootstrap or a migration failure stops the
      // gate before any test runs. 0011 needs the one legacy owner, so the history is reproduced
      // (0000-0010 -> owner -> 0011..head) rather than any guard being relaxed.
      await bootstrapDisposableDatabase({ Pool: pg.Pool, drizzle, migrate, url, journal, migrationsFolder: MIGRATIONS_FOLDER, ...defaultStageDeps, log: (message) => console.log(`${message} [${file}]`) });
    } catch (error) {
      fail(`database setup/migration failed for ${file} (${safeErrorSummary(error)}).`);
    }

    const run = spawnSync(process.execPath, ["--test", "--experimental-strip-types", "--test-reporter=tap", file], {
      env: { ...process.env, [CHILD_ENV_NAME]: url },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    process.stdout.write(run.stdout ?? "");
    if (run.stderr) process.stderr.write(run.stderr);
    if (run.error) fail(`test process did not start for ${file}: ${run.error.message}`);

    const counters = readTAPCounters(run.stdout);
    if (typeof counters.tests !== "number" || typeof counters.pass !== "number") {
      fail(`could not read the TAP summary for ${file} - the run did not report results.`);
    }
    totals.tests += counters.tests;
    totals.pass += counters.pass;
    totals.fail += counters.fail ?? 0;
    totals.skipped += counters.skipped ?? 0;
    totals.cancelled += counters.cancelled ?? 0;
    console.log(`[commerce-postgres] ${file}: tests=${counters.tests} pass=${counters.pass} skipped=${counters.skipped ?? 0}`);

    if (run.status !== 0 || (counters.fail ?? 1) !== 0 || (counters.cancelled ?? 1) !== 0) {
      fail(`${file} failed on real PostgreSQL.`);
    }
    if ((counters.skipped ?? 1) !== 0) {
      fail(`${counters.skipped} test(s) in ${file} were SKIPPED. Skipped is not verified: this gate requires a real PostgreSQL run.`);
    }
    if (counters.pass !== counters.tests) {
      fail(`${file}: pass=${counters.pass} does not match tests=${counters.tests}.`);
    }
  }

  console.log(
    `[commerce-postgres] total tests=${totals.tests} pass=${totals.pass} fail=${totals.fail} ` +
      `skipped=${totals.skipped} cancelled=${totals.cancelled}`,
  );
  if (totals.skipped !== 0) fail(`${totals.skipped} test(s) were SKIPPED across the commerce suites.`);
  if (totals.pass < EXPECTED_MIN_TESTS) fail(`expected at least ${EXPECTED_MIN_TESTS} executed tests, saw pass=${totals.pass}.`);
  console.log(`[commerce-postgres] OK: ${totals.pass} tests executed against real PostgreSQL, 0 skipped.`);
}

await main();
