#!/usr/bin/env node
/**
 * Sprint C — real-PostgreSQL integration gate (runs tests/sprint-b-postgres.integration.test.ts).
 *
 * Why a wrapper exists: the integration file is OPT-IN — without SPRINTB_PG_URL every one of its
 * tests reports "skipped", which is correct for the hermetic `pnpm test` suite but must NEVER be
 * accepted as "PostgreSQL verification passed". This runner therefore:
 *
 *   1. refuses to start unless SPRINTB_PG_URL is set;
 *   2. re-asserts the safety guards before spawning (loopback host + database name beginning
 *      with "sprintb") — the test file asserts them again at runtime;
 *   3. parses the TAP summary and fails unless every integration test actually RAN and PASSED
 *      (skipped !== 0, fail !== 0, cancelled !== 0 or pass < EXPECTED_MIN_TESTS all fail the gate).
 *
 * It never prints the connection URL. Run via `pnpm test:postgres`.
 */
import { spawnSync } from "node:child_process";

const TEST_FILE = "tests/sprint-b-postgres.integration.test.ts";
// Floor, not an exact count: new integration tests may be added, but the Sprint B.1 suite
// must never shrink below the 14 cases verified against real PostgreSQL.
const EXPECTED_MIN_TESTS = 14;

function fail(message) {
  console.error(`[postgres-integration] FAIL: ${message}`);
  process.exit(1);
}

const url = process.env.SPRINTB_PG_URL;
if (!url) {
  fail(
    "SPRINTB_PG_URL is not set. Point it at a disposable loopback PostgreSQL database whose name starts with \"sprintb\" " +
      '(see README.md#testing). Without it the integration tests only SKIP — a skip is not a verification.',
  );
}

let target;
try {
  target = new URL(url);
} catch {
  fail("SPRINTB_PG_URL is not a valid connection URL."); // never echo the value: it can carry credentials
}
if (!["127.0.0.1", "localhost", "::1"].includes(target.hostname)) {
  fail("SPRINTB_PG_URL must point at a loopback PostgreSQL instance (127.0.0.1, localhost or ::1).");
}
if (!target.pathname.slice(1).startsWith("sprintb")) {
  fail('the integration database name must start with "sprintb" (the suite drops and recreates its schemas).');
}

const run = spawnSync(
  process.execPath,
  ["--test", "--experimental-strip-types", "--test-reporter=tap", TEST_FILE],
  { env: process.env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);

process.stdout.write(run.stdout ?? "");
if (run.stderr) process.stderr.write(run.stderr);
if (run.error) fail(`test process did not start: ${run.error.message}`);

const counters = {};
for (const match of (run.stdout ?? "").matchAll(/^(?:#|ℹ)\s+(tests|suites|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$/gm)) {
  counters[match[1]] = Number(match[2]);
}
if (typeof counters.tests !== "number" || typeof counters.pass !== "number") {
  fail("could not read the TAP summary — the integration run did not report results.");
}

console.log(
  `[postgres-integration] tests=${counters.tests} pass=${counters.pass} fail=${counters.fail ?? 0} ` +
    `skipped=${counters.skipped ?? 0} cancelled=${counters.cancelled ?? 0}`,
);

if (run.status !== 0 || (counters.fail ?? 1) !== 0 || (counters.cancelled ?? 1) !== 0) {
  fail("integration tests failed on real PostgreSQL.");
}
if ((counters.skipped ?? 1) !== 0) {
  fail(`${counters.skipped} integration test(s) were SKIPPED. Skipped is not verified: this gate requires a real PostgreSQL run.`);
}
if (counters.pass !== counters.tests || counters.pass < EXPECTED_MIN_TESTS) {
  fail(`expected at least ${EXPECTED_MIN_TESTS} executed tests, saw pass=${counters.pass} of tests=${counters.tests}.`);
}
console.log(`[postgres-integration] OK: ${counters.pass} tests executed against real PostgreSQL, 0 skipped.`);
