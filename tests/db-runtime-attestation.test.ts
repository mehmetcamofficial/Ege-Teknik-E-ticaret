import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DATABASE_IDENTITY_SQL, DatabaseRuntimeAttestationError, FORBIDDEN_ROLES, attestDatabaseRuntime, connectionTarget, databaseRuntimeViolations, expectedIdentity,
} from "../lib/db-runtime-attestation.ts";

const env = {
  APP_ENV: "preview", EXPECTED_PREVIEW_STOREFRONT_DB_ROLE: "ege_preview_storefront", EXPECTED_PREVIEW_ADMIN_DB_ROLE: "ege_preview_admin",
  EXPECTED_PREVIEW_DB_NAME: "neondb", EXPECTED_NEON_PREVIEW_ENDPOINT_ID: "ep-quiet-river-a1b2c3d4",
};
const SECRET = "s3cr3t-Pa55word";
const url = (role: string, host = "ep-quiet-river-a1b2c3d4-pooler.eu-central-1.aws.neon.tech", db = "neondb") => `postgresql://${role}:${SECRET}@${host}/${db}?sslmode=verify-full`;
const session = (role: string, db = "neondb", sessionRole = role) => ({ role_name: role, session_name: sessionRole, database_name: db });
const queryReturning = (...rows: unknown[]) => { const calls: string[] = []; return { calls, query: async (text: string) => { calls.push(text); return { rows }; } }; };
const rejects = async (promise: Promise<unknown>, reasons: string[]) => {
  try { await promise; assert.fail("expected rejection"); }
  catch (error) {
    assert.ok(error instanceof DatabaseRuntimeAttestationError, String(error));
    assert.deepEqual(error.reasons, reasons);
    const text = `${error.message} ${JSON.stringify(error.reasons)} ${String(error.stack)}`;
    for (const leak of [SECRET, "ege_preview_storefront", "ege_preview_admin", "neondb", "ep-quiet-river", "neon.tech", "postgresql://"]) assert.ok(!text.includes(leak), `no ${leak} in the error`);
  }
};

test("attestation accepts the expected Preview identity for each scope, direct or pooled host", async () => {
  for (const [scope, role] of [["storefront", "ege_preview_storefront"], ["admin", "ege_preview_admin"]] as const) {
    for (const host of ["ep-quiet-river-a1b2c3d4-pooler.eu-central-1.aws.neon.tech", "ep-quiet-river-a1b2c3d4.eu-central-1.aws.neon.tech", "ep-quiet-river-a1b2c3d4.c-2.eu-central-1.aws.neon.tech"]) {
      const q = queryReturning(session(role));
      assert.deepEqual(await attestDatabaseRuntime({ scope, connectionString: url(role, host), env, query: q.query }), { role, database: "neondb", endpointId: "ep-quiet-river-a1b2c3d4" });
      assert.deepEqual(q.calls, [DATABASE_IDENTITY_SQL], "exactly one read-only identity query");
    }
  }
  assert.match(DATABASE_IDENTITY_SQL, /current_user/); assert.match(DATABASE_IDENTITY_SQL, /session_user/); assert.match(DATABASE_IDENTITY_SQL, /current_database\(\)/);
  assert.doesNotMatch(DATABASE_IDENTITY_SQL, /\b(FROM|INSERT|UPDATE|DELETE|SET)\b/i, "reads session functions only, touches no table and changes nothing");
});

test("every session mismatch fails closed with its own fixed reason", async () => {
  const s = "ege_preview_storefront";
  const cases: [unknown, string, string[]][] = [
    [session("ege_preview_admin"), url("ege_preview_admin"), ["role_mismatch"]],                                   // the admin role behind the storefront scope
    [session(s, "neondb", "ege_preview_admin"), url("ege_preview_admin"), ["role_switched", "role_mismatch"]],     // SET ROLE to the expected name
    [session(s, "other_db"), url(s, undefined, "other_db"), ["database_mismatch"]],
    [session(s), url(s, undefined, "other_db"), ["url_database_mismatch"]],                                           // a proxy that rewrites the database
    [session(s), url("someone_else"), ["url_role_mismatch"]],                                                         // a proxy that maps users
    [session("neondb_owner"), url("neondb_owner"), ["forbidden_role", "role_mismatch"]],
    [session(s), url(s, "ep-other-endpoint-9z9z9z9z-pooler.eu-central-1.aws.neon.tech"), ["endpoint_mismatch"]],
    [session(s), url(s, "db.example.test"), ["endpoint_not_neon"]],
    [session(s), url(s, "ep-quiet-river-a1b2c3d4.neon.tech.evil.example"), ["endpoint_not_neon"]],
    [session(s), url(s, "ep-quiet-river-a1b2c3d4.eu-central-1.aws.neon.tech.evil.example"), ["endpoint_not_neon"]],   // a Neon-shaped prefix on a foreign domain
    [session(s), "not a url", ["url_invalid"]],
    [session(s), `https://${s}:${SECRET}@ep-quiet-river-a1b2c3d4.eu-central-1.aws.neon.tech/neondb`, ["url_invalid"]],
  ];
  for (const [observed, connectionString, reasons] of cases) await rejects(attestDatabaseRuntime({ scope: "storefront", connectionString, env, query: queryReturning(observed).query }), reasons);
});

test("an unreadable identity is rejected, never assumed", async () => {
  const good = url("ege_preview_storefront");
  for (const rows of [[], [session("ege_preview_storefront"), session("ege_preview_storefront")], [null], [{ role_name: "ege_preview_storefront" }], [{ role_name: 1, session_name: 1, database_name: 1 }]])
    await rejects(attestDatabaseRuntime({ scope: "storefront", connectionString: good, env, query: async () => ({ rows }) }), ["identity_unreadable"]);
  await rejects(attestDatabaseRuntime({ scope: "storefront", connectionString: good, env, query: async () => ({ rows: undefined as unknown as unknown[] }) }), ["identity_unreadable"]);
});

test("a driver error or a hanging query fails closed without the driver message", async () => {
  const good = url("ege_preview_storefront");
  await rejects(attestDatabaseRuntime({ scope: "storefront", connectionString: good, env, query: async () => { throw new Error(`connect failed for ege_preview_storefront@ep-quiet-river-a1b2c3d4.neon.tech password ${SECRET}`); } }), ["identity_query_failed"]);
  await rejects(attestDatabaseRuntime({ scope: "storefront", connectionString: good, env, timeoutMs: 20, query: () => new Promise(() => {}) }), ["identity_timeout"]);
});

test("the configuration is checked before any query is sent", async () => {
  const bad: [Record<string, string | undefined>, string[]][] = [
    [{ ...env, APP_ENV: "production" }, ["not_preview"]], [{ ...env, APP_ENV: undefined }, ["not_preview"]],
    [{ ...env, EXPECTED_PREVIEW_STOREFRONT_DB_ROLE: "" }, ["EXPECTED_PREVIEW_STOREFRONT_DB_ROLE_invalid"]],
    [{ ...env, EXPECTED_PREVIEW_ADMIN_DB_ROLE: "Bad Role" }, ["EXPECTED_PREVIEW_ADMIN_DB_ROLE_invalid"]],
    [{ ...env, EXPECTED_PREVIEW_ADMIN_DB_ROLE: "ege_preview_storefront" }, ["expected_roles_not_distinct"]],
    [{ ...env, EXPECTED_PREVIEW_ADMIN_DB_ROLE: "neondb_owner" }, ["expected_role_forbidden"]],
    [{ ...env, EXPECTED_PREVIEW_DB_NAME: "" }, ["EXPECTED_PREVIEW_DB_NAME_invalid"]],
    [{ ...env, EXPECTED_NEON_PREVIEW_ENDPOINT_ID: "br-nameless-mountain-awib28a9" }, ["EXPECTED_NEON_PREVIEW_ENDPOINT_ID_invalid"]],
    [{ ...env, EXPECTED_NEON_PREVIEW_ENDPOINT_ID: undefined }, ["EXPECTED_NEON_PREVIEW_ENDPOINT_ID_invalid"]],
  ];
  for (const [e, reasons] of bad) {
    const q = queryReturning(session("ege_preview_storefront"));
    await rejects(attestDatabaseRuntime({ scope: "storefront", connectionString: url("ege_preview_storefront"), env: e, query: q.query }), reasons);
    assert.equal(q.calls.length, 0, `no session is asked when ${reasons[0]}`);
  }
  assert.deepEqual(expectedIdentity("root" as "admin", env), { ok: false, reasons: ["invalid_scope"] });
  for (const role of FORBIDDEN_ROLES) assert.deepEqual(expectedIdentity("admin", { ...env, EXPECTED_PREVIEW_ADMIN_DB_ROLE: role }).ok, false, role);
});

test("connection targets are read without exposing the password; pooler and direct hosts are one endpoint", () => {
  assert.deepEqual(connectionTarget(url("ege_preview_storefront")), { role: "ege_preview_storefront", database: "neondb", endpointId: "ep-quiet-river-a1b2c3d4" });
  assert.equal(connectionTarget(url("r", "ep-quiet-river-a1b2c3d4.eu-central-1.aws.neon.tech"))?.endpointId, "ep-quiet-river-a1b2c3d4");
  assert.deepEqual(connectionTarget("postgresql://a%5Fb:x@db.example.test/my%2Ddb"), { role: "a_b", database: "my-db", endpointId: null }, "percent-decoded like the scope guard");
  assert.equal(connectionTarget("postgresql://user:pw@host"), null, "no database"); assert.equal(connectionTarget("postgresql://:pw@host/db"), null, "no role");
  assert.equal(connectionTarget("postgresql://%E0%A4%A:pw@host/db"), null, "broken encoding");
  assert.ok(!JSON.stringify(connectionTarget(url("r"))).includes(SECRET));
  assert.deepEqual(databaseRuntimeViolations(session("r"), { role: "r", database: "neondb", endpointId: "ep-quiet-river-a1b2c3d4" }, url("r")), []);
});

test("the module only attests: it does not log, connect, or change the scoped connection wiring", () => {
  const source = readFileSync("lib/db-runtime-attestation.ts", "utf8");
  assert.doesNotMatch(source, /console\.|process\.env|from "pg"|new Pool|fetch\(/, "no logging, no implicit environment, no connection of its own");
  const db = readFileSync("db/index.ts", "utf8");
  assert.doesNotMatch(db, /db-runtime-attestation/, "the scoped pools are not wired to it yet (core module only)");
});
