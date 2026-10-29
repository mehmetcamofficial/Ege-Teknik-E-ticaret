#!/usr/bin/env node
/**
 * Permanent real-PostgreSQL gate for lib/db-runtime-attestation.ts (tests/db-runtime-attestation-postgres.test.ts).
 *
 * The test file is OPT-IN (without its configuration it reports "skipped"), and a skip is not a verification. This runner therefore:
 *
 *   1. refuses unless CI=true and DB_ATTEST_PG_URL is a loopback PostgreSQL URL that is not the recovery port (55432) - no Neon, no Preview, no Production;
 *   2. proves the CLUSTER is disposable with scripts/disposable-cluster-attest.mjs (the same proof as the worker and B9 suites). If it cannot connect, or the
 *      proof fails, the run FAILS: there is no "could not run" outcome that looks like a pass;
 *   3. opens an oid ledger BEFORE creating anything, then creates its OWN two databases and four roles (storefront, admin, a switcher that is a member of the
 *      storefront role, and a SUPERUSER role) with random sprintb_* names and a random password. It refuses to continue if the login cannot create them;
 *   4. runs only that test file, with a minimal environment (no CI / GitHub variables, no cluster marker), and fails unless EXACTLY the expected number of
 *      tests ran and passed (fail, cancelled or skipped !== 0 all fail the gate);
 *   5. drops what it created - each object only if its CURRENT oid equals the recorded one (a recreated object is never touched) - and verifies that nothing
 *      of this run is left.
 *
 * It never prints a URL, host, role name or password. NOTE printed on every run: the Neon endpoint check is client-side, so the Neon-form URLs used by the
 * test are NOT a verification of a real Neon endpoint.
 * env: DB_ATTEST_PG_URL (host and credentials of the disposable cluster; its database part only supplies the login).
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { attestDisposableCluster } from "./disposable-cluster-attest.mjs";
import { openLedger, releaseOwned } from "./test-resource-ledger.mjs";

const TEST_FILE = "tests/db-runtime-attestation-postgres.test.ts";
const EXPECTED_TESTS = 12;
const LOOPBACK = ["127.0.0.1", "localhost", "::1"];
const refuse = (why) => { console.error(`[db-attestation] REFUSED: ${why}`); process.exit(1); };
const redact = (text) => text.replace(/postgres(?:ql)?:\/\/[^\s"']+/g, "[redacted]");
let failed = false;
const fail = (why) => { failed = true; console.error(`[db-attestation] FAIL: ${redact(String(why)).slice(0, 600)}`); };

const base = (() => { try { return new URL(process.env.DB_ATTEST_PG_URL ?? ""); } catch { return null; } })();
if (process.env.CI !== "true") refuse("requires CI=true");
if (!base || !["postgres:", "postgresql:"].includes(base.protocol)) refuse("DB_ATTEST_PG_URL must be a PostgreSQL URL");
const host = base.hostname.replace(/^\[|\]$/g, "");
if (!LOOPBACK.includes(host)) refuse("loopback PostgreSQL URL required");
if (base.port === "55432") refuse("the recovery cluster port is never allowed");
console.log("[db-attestation] NOTE: the Neon endpoint is attested on the client side from the dialled host. The Neon-form URLs used here are NOT a verification of a real Neon endpoint.");

const urlFor = (database) => { const u = new URL(base); u.pathname = `/${database}`; return u.toString(); };
const maintenance = new pg.Pool({ connectionString: urlFor("postgres"), max: 1, connectionTimeoutMillis: 8000 });
maintenance.on("error", () => {});
const nonce = randomBytes(5).toString("hex");
const password = randomBytes(18).toString("base64url");
const names = { main: `sprintb_dbatt_${nonce}_a`, other: `sprintb_dbatt_${nonce}_b`, storefront: `sprintb_dbatt_${nonce}_store`, admin: `sprintb_dbatt_${nonce}_admin`, switcher: `sprintb_dbatt_${nonce}_swap`, su: `sprintb_dbatt_${nonce}_super` };
let ledger = null;

try {
  let route;
  try { route = await attestDisposableCluster({ url: urlFor("postgres"), query: (text, params) => maintenance.query(text, params), env: process.env }); }
  catch (error) { throw new Error(`the cluster could not be reached or proven disposable (${error instanceof Error ? error.message.split(":")[0] : "error"}): this is not a pass`); }
  console.log(`[db-attestation] disposable cluster attested (${route} route)`);
  const systemId = (await maintenance.query("SELECT system_identifier::text AS id FROM pg_control_system()")).rows[0].id;
  ledger = openLedger({ suite: "dbatt", systemId });                       // before anything is created: a run that cannot be recovered creates nothing
  const me = (await maintenance.query("SELECT current_user::text AS u, r.rolsuper, r.rolcreaterole, r.rolcreatedb FROM pg_roles r WHERE r.rolname = current_user")).rows[0];
  if (!me.rolsuper) throw new Error("the cluster login must be a superuser (the test needs a real SUPERUSER role and SET SESSION AUTHORIZATION)");
  for (const name of [names.main, names.other]) if ((await maintenance.query("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount) throw new Error("a scratch name already exists");

  const quoted = (n) => `"${n}"`;
  for (const [key, attrs] of [["storefront", "LOGIN"], ["admin", "LOGIN"], ["switcher", "LOGIN"], ["su", "LOGIN SUPERUSER"]]) {
    await maintenance.query(`CREATE ROLE ${quoted(names[key])} ${attrs} PASSWORD '${password}'`);
    ledger.state.roles.push({ name: names[key], oid: (await maintenance.query("SELECT oid::text AS oid FROM pg_roles WHERE rolname = $1", [names[key]])).rows[0].oid }); ledger.save();
  }
  await maintenance.query(`GRANT ${quoted(names.storefront)} TO ${quoted(names.switcher)}`);
  for (const key of ["main", "other"]) {
    await maintenance.query(`CREATE DATABASE ${quoted(names[key])}`);
    ledger.state.databases.push({ name: names[key], oid: (await maintenance.query("SELECT oid::text AS oid FROM pg_database WHERE datname = $1", [names[key]])).rows[0].oid }); ledger.save();
  }

  const login = decodeURIComponent(base.username);
  const config = { host, port: base.port || "5432", password, databases: { main: names.main, other: names.other },
    roles: { storefront: names.storefront, admin: names.admin, switcher: names.switcher, su: names.su }, login: { user: login, password: decodeURIComponent(base.password) } };
  // Only what the test needs: no CI / GitHub variables, no cluster attestation marker, no other credentials.
  const childEnv = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", DB_ATTEST_TEST_CONFIG: JSON.stringify(config) };
  const run = spawnSync(process.execPath, ["--test", "--experimental-strip-types", "--test-reporter=tap", TEST_FILE], { env: childEnv, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
  // A short login password (a disposable cluster may use a plain word) would also match file paths, so it is only scrubbed when it is long enough to be a real needle.
  const scrub = (text) => redact(text).replaceAll(password, "[redacted]").replaceAll(config.login.password.length >= 12 ? config.login.password : "\u0000", "[redacted]");
  process.stdout.write(scrub(run.stdout ?? ""));
  if (run.stderr) process.stderr.write(scrub(run.stderr));
  if (run.error) throw new Error(`test process did not start: ${run.error.message}`);

  const counters = {};
  for (const match of (run.stdout ?? "").matchAll(/^(?:#|ℹ)\s+(tests|suites|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$/gm)) counters[match[1]] = Number(match[2]);
  if (typeof counters.tests !== "number" || typeof counters.pass !== "number") throw new Error("could not read the TAP summary - the run did not report results");
  console.log(`[db-attestation] tests=${counters.tests} pass=${counters.pass} fail=${counters.fail ?? 0} skipped=${counters.skipped ?? 0} cancelled=${counters.cancelled ?? 0}`);
  if (run.status !== 0 || (counters.fail ?? 1) !== 0 || (counters.cancelled ?? 1) !== 0) throw new Error("the attestation test failed on real PostgreSQL");
  if ((counters.skipped ?? 1) !== 0) throw new Error(`${counters.skipped} test(s) were SKIPPED. Skipped is not verified: this gate requires a real PostgreSQL run`);
  if (counters.tests !== EXPECTED_TESTS || counters.pass !== EXPECTED_TESTS) throw new Error(`expected exactly ${EXPECTED_TESTS} executed tests, saw pass=${counters.pass} of tests=${counters.tests}`);
  console.log(`[db-attestation] OK: ${EXPECTED_TESTS} tests executed against real PostgreSQL sessions, 0 skipped.`);
} catch (error) {
  fail(error instanceof Error ? error.message : error);
} finally {
  if (!ledger || (ledger.state.databases.length + ledger.state.roles.length) === 0) console.log("[db-attestation] cleanup: nothing was created by this run, nothing is dropped");
  else {
    try {
      const problems = await releaseOwned({ query: (t, p) => maintenance.query(t, p), databases: ledger.state.databases, roles: ledger.state.roles });
      const left = (await maintenance.query("SELECT (SELECT count(*) FROM pg_database WHERE datname LIKE $1)::int + (SELECT count(*) FROM pg_roles WHERE rolname LIKE $1)::int AS n", [`sprintb_dbatt_${nonce}%`])).rows[0].n;
      if (problems.length || left !== 0) fail(`cleanup incomplete (${problems.length} problem(s), ${left} object(s) left)`);
      else { ledger.remove(); console.log("[db-attestation] cleanup: scratch databases and roles dropped"); }
    } catch (error) { fail(`cleanup incomplete: ${error instanceof Error ? error.message : error}`); }
  }
  await maintenance.end().catch(() => {});
  if (failed) process.exitCode = 1;
}
