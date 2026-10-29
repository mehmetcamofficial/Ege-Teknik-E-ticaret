/**
 * lib/db-runtime-attestation.ts against REAL PostgreSQL sessions (current_user / session_user / current_database() come from the server).
 *
 * OPT-IN and never run by hand: it needs the throwaway database, roles and credentials that scripts/test-db-attestation-postgres.mjs creates (and
 * removes) on a proven-disposable loopback cluster, and it is skipped without them. A skip is NOT a verification: the wrapper fails unless every test
 * here ran and passed.
 *
 * WHAT THIS DOES NOT PROVE: the Neon endpoint. Neon exposes no SQL-visible endpoint id, so the module attests it on the CLIENT side from the host named
 * in the connection string. Here the real session is local, so the Neon-form URLs below are strings handed to the module - they exercise its parsing
 * and comparison, not a real Neon endpoint. That needs a Preview-only run with explicit approval.
 */
import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { DatabaseRuntimeAttestationError, FORBIDDEN_ROLES, attestDatabaseRuntime, type AttestedScope } from "../lib/db-runtime-attestation.ts";

type Config = { host: string; port: string; password: string; databases: { main: string; other: string }; roles: { storefront: string; admin: string; switcher: string; su: string }; login: { user: string; password: string } };
const raw = process.env.DB_ATTEST_TEST_CONFIG;
const config: Config | null = raw ? JSON.parse(raw) : null;
const skip = !config;

// Written out here on purpose: the expectation must not be derived from the constant under test.
const DOCUMENTED_FORBIDDEN = ["postgres", "neondb_owner", "cloud_admin", "ege_teknik_preview_app", "ege_teknik_preview_runtime"];
const ENDPOINT = "ep-quiet-river-a1b2c3d4";
const NEON_HOST = `${ENDPOINT}-pooler.eu-central-1.aws.neon.tech`;
const expectedEnv = (c: Config) => ({ APP_ENV: "preview", EXPECTED_PREVIEW_STOREFRONT_DB_ROLE: c.roles.storefront, EXPECTED_PREVIEW_ADMIN_DB_ROLE: c.roles.admin,
  EXPECTED_PREVIEW_DB_NAME: c.databases.main, EXPECTED_NEON_PREVIEW_ENDPOINT_ID: ENDPOINT });
/** The URL the module is told the session was opened with (Neon-form host: a string, not a verified endpoint). */
const neonUrl = (c: Config, role: string, database: string, host = NEON_HOST) => `postgresql://${role}:${c.password}@${host}/${database}?sslmode=verify-full`;

/** A real session as `role` on `database`; guards the whole suite to a loopback, non-recovery server before it dials anything. */
async function open(c: Config, role: string, database: string, password = c.password) {
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(c.host), "loopback only"); assert.notEqual(c.port, "55432", "never the recovery cluster");
  const client = new pg.Client({ host: c.host, port: Number(c.port), user: role, password, database, connectionTimeoutMillis: 5000 });
  client.on("error", () => {});                    // a killed backend emits 'error'; the test asserts the outcome instead
  await client.connect();
  return client;
}
const outcome = async (promise: Promise<unknown>, c: Config): Promise<string[] | "ACCEPTED"> => {
  try { await promise; return "ACCEPTED"; }
  catch (error) {
    assert.ok(error instanceof DatabaseRuntimeAttestationError, "only the module's own error ever escapes");
    const visible = `${error.message} ${JSON.stringify(error.reasons)} ${String(error.stack)}`;
    // The cluster login's own password is only searched for when it is long enough to be a meaningful needle: a disposable cluster may use a word such as
    // "postgres", which also appears in file paths and would match every stack trace. The per-run password (random) and every name are always searched.
    const needles = [c.password, ...(c.login.password.length >= 12 ? [c.login.password] : []), c.roles.storefront, c.roles.admin, c.roles.su, c.databases.main, ENDPOINT, "neon.tech", "postgresql://"];
    for (const secret of needles) assert.ok(!visible.includes(secret), "the error exposes no credential, role, database or host");
    return error.reasons;
  }
};
const attest = (c: Config, scope: AttestedScope, client: pg.Client, connectionString: string, timeoutMs?: number) =>
  attestDatabaseRuntime({ scope, connectionString, env: expectedEnv(c), query: (text) => client.query(text), timeoutMs });

test("PG: the expected role on the expected database is accepted, for both scopes", { skip }, async () => {
  const c = config!;
  for (const [scope, role] of [["storefront", c.roles.storefront], ["admin", c.roles.admin]] as const) {
    const client = await open(c, role, c.databases.main);
    try {
      // The facts really come from the server: ask it separately and compare.
      const row = (await client.query("SELECT current_user::text AS u, session_user::text AS s, current_database()::text AS d")).rows[0];
      assert.deepEqual([row.u, row.s, row.d], [role, role, c.databases.main]);
      assert.equal(await outcome(attest(c, scope, client, neonUrl(c, role, c.databases.main)), c), "ACCEPTED");
      assert.equal(await outcome(attest(c, scope, client, neonUrl(c, role, c.databases.main, `${ENDPOINT}.eu-central-1.aws.neon.tech`)), c), "ACCEPTED", "the direct host is the same endpoint as the pooled one");
    } finally { await client.end(); }
  }
});

test("PG: the other scope's role is refused", { skip }, async () => {
  const c = config!, client = await open(c, c.roles.admin, c.databases.main);
  try {
    assert.deepEqual(await outcome(attest(c, "storefront", client, neonUrl(c, c.roles.admin, c.databases.main)), c), ["role_mismatch"]);
    assert.equal(await outcome(attest(c, "admin", client, neonUrl(c, c.roles.admin, c.databases.main)), c), "ACCEPTED", "control: the right scope for the same session passes");
  } finally { await client.end(); }
});

test("PG: SET ROLE to the expected role is refused (session_user stays the real login)", { skip }, async () => {
  const c = config!, client = await open(c, c.roles.switcher, c.databases.main);
  try {
    await client.query(`SET ROLE "${c.roles.storefront}"`);
    const row = (await client.query("SELECT current_user::text AS u, session_user::text AS s")).rows[0];
    assert.deepEqual([row.u, row.s], [c.roles.storefront, c.roles.switcher], "the server really reports the switch");
    const reasons = await outcome(attest(c, "storefront", client, neonUrl(c, c.roles.storefront, c.databases.main)), c);
    assert.ok(Array.isArray(reasons) && reasons.includes("role_switched") && reasons.includes("role_mismatch") && reasons.includes("url_role_mismatch"), JSON.stringify(reasons));
  } finally { await client.end(); }
});

test("PG: SET SESSION AUTHORIZATION by a privileged login cannot impersonate the expected role", { skip }, async () => {
  const c = config!, client = await open(c, c.roles.su, c.databases.main);
  try {
    await client.query(`SET SESSION AUTHORIZATION "${c.roles.storefront}"`);
    const row = (await client.query("SELECT current_user::text AS u, session_user::text AS s")).rows[0];
    assert.deepEqual([row.u, row.s], [c.roles.storefront, c.roles.storefront], "both names now read as the expected role: the session itself looks right");
    // The connection string still names the login that opened the connection, so the impersonation is caught there.
    assert.deepEqual(await outcome(attest(c, "storefront", client, neonUrl(c, c.roles.su, c.databases.main)), c), ["url_role_mismatch"]);
  } finally { await client.end(); }
});

test("PG: the expected role on another database is refused, from the session and from the URL", { skip }, async () => {
  const c = config!, client = await open(c, c.roles.storefront, c.databases.other);
  try {
    assert.deepEqual(await outcome(attest(c, "storefront", client, neonUrl(c, c.roles.storefront, c.databases.other)), c), ["database_mismatch"]);
    assert.deepEqual(await outcome(attest(c, "storefront", client, neonUrl(c, c.roles.storefront, c.databases.main)), c), ["database_mismatch", "url_database_mismatch"], "a URL that claims the expected database does not hide it");
  } finally { await client.end(); }
});

test("PG: privileged sessions are refused (a real superuser role and the cluster's own login)", { skip }, async () => {
  const c = config!;
  const su = await open(c, c.roles.su, c.databases.main);
  try {
    assert.equal((await su.query("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")).rows[0].rolsuper, true, "the server confirms it is a superuser");
    assert.deepEqual(await outcome(attest(c, "admin", su, neonUrl(c, c.roles.su, c.databases.main)), c), ["role_mismatch"]);
  } finally { await su.end(); }
  const login = await open(c, c.login.user, c.databases.main, c.login.password);
  try {
    const reasons = await outcome(attest(c, "admin", login, neonUrl(c, c.login.user, c.databases.main)), c);
    assert.ok(Array.isArray(reasons) && reasons.includes("role_mismatch"), "never accepted");
    assert.deepEqual([...FORBIDDEN_ROLES], DOCUMENTED_FORBIDDEN, "the list of refused broad roles is pinned");
    assert.equal(Array.isArray(reasons) && reasons.includes("forbidden_role"), DOCUMENTED_FORBIDDEN.includes(c.login.user), "a broad role name is flagged, whatever the module's own list says");
  } finally { await login.end(); }
});

test("PG: a wrong Neon endpoint in the dialled host is refused", { skip }, async () => {
  const c = config!, client = await open(c, c.roles.storefront, c.databases.main);
  try {
    assert.deepEqual(await outcome(attest(c, "storefront", client, neonUrl(c, c.roles.storefront, c.databases.main, "ep-other-endpoint-9z9z9z9z-pooler.eu-central-1.aws.neon.tech")), c), ["endpoint_mismatch"]);
    assert.deepEqual(await outcome(attest(c, "storefront", client, neonUrl(c, c.roles.storefront, c.databases.main, "ep-quiet-river-a1b2c3d5.eu-central-1.aws.neon.tech")), c), ["endpoint_mismatch"], "one character off");
  } finally { await client.end(); }
});

test("PG: hostname spoofing is refused, including the real loopback host of this very connection", { skip }, async () => {
  const c = config!, client = await open(c, c.roles.storefront, c.databases.main);
  try {
    const real = `postgresql://${c.roles.storefront}:${c.password}@${c.host}:${c.port}/${c.databases.main}`;
    for (const host of [`${c.host}:${c.port}`, `${ENDPOINT}.neon.tech.evil.example`, `${ENDPOINT}.eu-central-1.aws.neon.tech.evil.example`, `${ENDPOINT}.eu-central-1.aws.xneon.tech`, `${ENDPOINT}.neon.tech.`, `neon.tech`, `evil-${ENDPOINT}.eu-central-1.aws.neon.tech`, `${ENDPOINT}-pooler.eu-central-1.aws.neon.tech.localhost`])
      assert.deepEqual(await outcome(attest(c, "storefront", client, host === `${c.host}:${c.port}` ? real : neonUrl(c, c.roles.storefront, c.databases.main, host)), c), ["endpoint_not_neon"], host.replace(c.host, "<loopback>"));
    // Userinfo must not be read as the host (the classic `trusted@evil` trick): the Neon-looking name is the password here, and the real host is foreign.
    assert.deepEqual(await outcome(attest(c, "storefront", client, `postgresql://${c.roles.storefront}:${ENDPOINT}.eu-central-1.aws.neon.tech@evil.example/${c.databases.main}`), c), ["endpoint_not_neon"]);
    // ... and here it is the username slot, so the role no longer matches the session either.
    assert.deepEqual(await outcome(attest(c, "storefront", client, `postgresql://${ENDPOINT}.eu-central-1.aws.neon.tech@evil.example/${c.databases.main}`), c), ["url_role_mismatch", "endpoint_not_neon"]);
  } finally { await client.end(); }
});

test("PG: a connection killed by the server, and one closed under the query, fail closed", { skip }, async () => {
  const c = config!, killer = await open(c, c.login.user, c.databases.main, c.login.password);
  try {
    const victim = await open(c, c.roles.storefront, c.databases.main);
    const pid = (await victim.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await killer.query("SELECT pg_terminate_backend($1)", [pid]);
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(await outcome(attest(c, "storefront", victim, neonUrl(c, c.roles.storefront, c.databases.main)), c), ["identity_query_failed"], "the server terminated the backend");
    await victim.end().catch(() => {});
    const closing = await open(c, c.roles.storefront, c.databases.main);
    const query = async (text: string) => { await closing.end(); return closing.query(text); };
    assert.deepEqual(await outcome(attestDatabaseRuntime({ scope: "storefront", connectionString: neonUrl(c, c.roles.storefront, c.databases.main), env: expectedEnv(c), query }), c), ["identity_query_failed"], "closed under the query");
  } finally { await killer.end(); }
});

test("PG: a session that does not answer in time fails closed with the timeout reason", { skip }, async () => {
  const c = config!, client = await open(c, c.roles.storefront, c.databases.main);
  try {
    const started = Date.now();
    const reasons = await outcome(attestDatabaseRuntime({ scope: "storefront", connectionString: neonUrl(c, c.roles.storefront, c.databases.main), env: expectedEnv(c), timeoutMs: 300, query: () => client.query("SELECT pg_sleep(2)") }), c);
    assert.deepEqual(reasons, ["identity_timeout"]); assert.ok(Date.now() - started < 1500, "it did not wait for the slow session");
  } finally { await client.end().catch(() => {}); }
});

test("PG: a wrong configuration never reaches the server", { skip }, async () => {
  const c = config!, client = await open(c, c.roles.storefront, c.databases.main);
  try {
    let asked = 0;
    const reasons = await outcome(attestDatabaseRuntime({ scope: "storefront", connectionString: neonUrl(c, c.roles.storefront, c.databases.main), env: { ...expectedEnv(c), APP_ENV: "production" }, query: (t) => { asked++; return client.query(t); } }), c);
    assert.deepEqual(reasons, ["not_preview"]); assert.equal(asked, 0);
  } finally { await client.end(); }
});

test("PG: a real server answer that is not exactly one identity row is refused", { skip }, async () => {
  const c = config!, client = await open(c, c.roles.storefront, c.databases.main);
  try {
    const url = neonUrl(c, c.roles.storefront, c.databases.main), run = (sql: string) => attestDatabaseRuntime({ scope: "storefront", connectionString: url, env: expectedEnv(c), query: () => client.query(sql) });
    assert.deepEqual(await outcome(run("SELECT current_user::text AS role_name, session_user::text AS session_name, current_database()::text AS database_name WHERE false"), c), ["identity_unreadable"], "zero rows");
    const one = "SELECT current_user::text AS role_name, session_user::text AS session_name, current_database()::text AS database_name";
    assert.deepEqual(await outcome(run(`${one} UNION ALL ${one}`), c), ["identity_unreadable"], "two rows");
    assert.deepEqual(await outcome(run("SELECT 1 AS role_name, 2 AS session_name, 3 AS database_name"), c), ["identity_unreadable"], "wrong types");
    assert.equal(await outcome(run(one), c), "ACCEPTED", "control: the real answer passes");
  } finally { await client.end(); }
});
