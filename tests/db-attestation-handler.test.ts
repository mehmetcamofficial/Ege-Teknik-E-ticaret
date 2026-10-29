import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveScopedDatabaseUrl, scopedCheckoutEnabled } from "../lib/db-access-scope.ts";
import { CHECK_ORDER, configurationProblems, handleDbAttestation, sameSecret, type AttestationSession, type DbAttestationDeps } from "../lib/db-attestation-handler.ts";
import { connectionTarget } from "../lib/db-runtime-attestation.ts";
import { isSameOrigin, requiresSameOrigin } from "../lib/security-policy.ts";

const SECRET = "Pr3view-attest-token-0123456789abcdef!";
const DISPATCH_SECRET = "Dispatch-secret-9876543210fedcba-XYZ!!";
const ENDPOINT = "ep-quiet-river-a1b2c3d4", HOST = `${ENDPOINT}-pooler.eu-central-1.aws.neon.tech`;
const PW = { owner: "ownerpw-S3cr3t", store: "storepw-S3cr3t", admin: "adminpw-S3cr3t" };
const env = (over: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  VERCEL_ENV: "preview", APP_ENV: "preview", DB_ATTESTATION_ENABLED: "true", DB_ATTESTATION_SECRET: SECRET, NOTIFICATION_DISPATCH_SECRET: DISPATCH_SECRET,
  NEON_BRANCH_ID: "br-nameless-mountain-awib28a9", EXPECTED_NEON_PREVIEW_BRANCH_ID: "br-nameless-mountain-awib28a9", EXPECTED_NEON_PRODUCTION_BRANCH_ID: "br-prod-main-0000aaaa",
  EXPECTED_PREVIEW_STOREFRONT_DB_ROLE: "ege_preview_storefront", EXPECTED_PREVIEW_ADMIN_DB_ROLE: "ege_preview_admin", EXPECTED_PREVIEW_DB_NAME: "neondb", EXPECTED_NEON_PREVIEW_ENDPOINT_ID: ENDPOINT,
  DATABASE_URL: `postgresql://owner_role:${PW.owner}@${HOST}/neondb?sslmode=verify-full`,
  STOREFRONT_DATABASE_URL: `postgresql://ege_preview_storefront:${PW.store}@${HOST}/neondb?sslmode=verify-full`,
  ADMIN_DATABASE_URL: `postgresql://ege_preview_admin:${PW.admin}@${HOST}/neondb?sslmode=verify-full`,
  CHECKOUT_SCOPED_DB_ENABLED: "true", ...over,
});

type Spy = { connects: string[]; queries: string[]; closes: number; resolves: number; trace: string[] };
/** The session answers as the role in the URL it was opened with, unless `answer` says otherwise. Counts every connect, query and close. */
function setup(envOver: Record<string, string | undefined> = {}, opts: { answer?: (target: { role: string; database: string }, scope: "storefront" | "admin") => unknown; connect?: (url: string) => Promise<AttestationSession>; timeouts?: DbAttestationDeps["timeouts"]; omitEnv?: boolean } = {}) {
  const spy: Spy = { connects: [], queries: [], closes: 0, resolves: 0, trace: [] };
  const e = opts.omitEnv ? {} : env(envOver);
  const deps: DbAttestationDeps = {
    env: e,
    resolveUrl: (scope, vars) => { spy.resolves++; return resolveScopedDatabaseUrl(scope, vars); },
    scopedCheckoutEnabled,
    connect: opts.connect ? async (url) => { spy.connects.push(url); return opts.connect!(url); } : async (url) => {
      spy.connects.push(url);
      const target = connectionTarget(url)!, scope = target.role === e.EXPECTED_PREVIEW_ADMIN_DB_ROLE ? "admin" : "storefront";
      return { query: async (text) => { spy.queries.push(text); return { rows: [opts.answer ? opts.answer(target, scope) : { role_name: target.role, session_name: target.role, database_name: target.database }] }; }, close: async () => { spy.closes++; } };
    },
    trace: (s) => spy.trace.push(s), timeouts: opts.timeouts,
  };
  return { deps, spy };
}
/** `auth`: undefined = the valid token; null = no Authorization header at all. */
const post = (auth: string | null | undefined = `Bearer ${SECRET}`, method = "POST") => new Request("https://preview.example.test/api/internal/db-attestation", { method, headers: { ...(auth !== null ? { authorization: auth } : {}), origin: "https://preview.example.test", host: "preview.example.test" } });

/** Every field a response can carry; a given response has only some of them (the tests assert which). */
type Scope = { status: string; reasons: string[] };
type Body = { ok: boolean; status: string; error: string; reasons: string[]; storefront: Scope; admin: Scope; checkoutActivation: string };
/** Nothing a response says may contain a credential, URL, host, role, database, endpoint id, branch id or driver text - checked for EVERY response in this file. */
const FORBIDDEN = [SECRET, DISPATCH_SECRET, ...Object.values(PW), "postgresql://", "neon.tech", ENDPOINT, "ege_preview_storefront", "ege_preview_admin", "owner_role", "neondb", "br-nameless", "br-prod", "eu-central-1", "sslmode", "ECONNREFUSED", "password authentication", "relation ", "SELECT "];
async function call(deps: DbAttestationDeps, request = post()) {
  const response = await handleDbAttestation(request, deps), text = await response.text();
  for (const needle of FORBIDDEN) assert.ok(!text.includes(needle), `the body does not contain "${needle.slice(0, 12)}…"`);
  assert.equal(response.headers.get("cache-control"), "no-store", "never cached");
  assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
  return { status: response.status, body: JSON.parse(text) as Body, headers: response.headers };
}
const untouched = (spy: Spy) => assert.deepEqual([spy.connects.length, spy.queries.length, spy.closes], [0, 0, 0], "no connection was opened and no SQL was sent");

test("authorised Preview request: both scoped identities verified and the checkout flag on (nothing is claimed about the checkout code path)", async () => {
  const { deps, spy } = setup();
  const r = await call(deps);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, storefront: { status: "verified", reasons: [] }, admin: { status: "verified", reasons: [] }, checkoutActivation: "flag_enabled" });
  assert.equal(spy.connects.length, 2, "one short-lived session per scope"); assert.equal(spy.queries.length, 2); assert.equal(spy.closes, 2, "every session is closed");
  assert.notEqual(spy.connects[0], spy.connects[1], "the storefront and the admin connection are separate");
  assert.deepEqual(spy.trace, [...CHECK_ORDER], "every check ran, in the documented order");
});

test("the security checks run in a fixed order and each failure stops the request before anything later", async () => {
  const cases: [string, Record<string, string | undefined>, Request, number, string[]][] = [
    ["environment first", { VERCEL_ENV: "production", APP_ENV: "production", DB_ATTESTATION_ENABLED: undefined, DB_ATTESTATION_SECRET: undefined }, post("Bearer wrong"), 404, ["environment"]],
    ["then the feature flag", { DB_ATTESTATION_ENABLED: "false", DB_ATTESTATION_SECRET: undefined }, post("Bearer wrong"), 404, ["environment", "feature"]],
    ["then the secret", { DB_ATTESTATION_SECRET: "short" }, post("Bearer wrong"), 404, ["environment", "feature", "secret"]],
    ["then authorization, before the method", {}, post("Bearer wrong", "GET"), 401, ["environment", "feature", "secret", "authorization"]],
    ["then the method", {}, post(undefined, "GET"), 405, ["environment", "feature", "secret", "authorization", "method"]],
    ["then the configuration, before any database", { NEON_BRANCH_ID: "br-someone-else-1234" }, post(), 503, ["environment", "feature", "secret", "authorization", "method", "configuration"]],
  ];
  for (const [name, over, request, status, expectedTrace] of cases) {
    const { deps, spy } = setup(over); const r = await call(deps, request);
    assert.equal(r.status, status, name); assert.deepEqual(spy.trace, expectedTrace, name); untouched(spy); assert.equal(spy.resolves, 0, `${name}: not even the connection string is resolved`);
  }
});

test("outside Preview - Production, Development, mixed or unset - the endpoint does not exist", async () => {
  for (const [vercel, app] of [["production", "production"], ["production", "preview"], ["preview", "production"], ["development", "development"], ["development", "preview"], ["preview", "development"], [undefined, "preview"], ["preview", undefined], [undefined, undefined], ["Preview", "preview"], ["preview ", "preview"]] as const) {
    const { deps, spy } = setup({ VERCEL_ENV: vercel, APP_ENV: app });
    const r = await call(deps); assert.equal(r.status, 404, `${vercel}/${app}`); assert.deepEqual(r.body, { error: "not_found" }); untouched(spy);
    for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) assert.equal((await call(deps, post(undefined, method))).status, 404, `${method} in ${vercel}/${app} is just as absent`);
  }
  const { deps, spy } = setup({}, { omitEnv: true }); assert.equal((await call(deps)).status, 404); untouched(spy);
});

test("feature flag: anything but exactly \"true\" is 404", async () => {
  for (const flag of [undefined, "", "false", "TRUE", "True", "1", "yes", "true ", " true", "on"]) { const { deps, spy } = setup({ DB_ATTESTATION_ENABLED: flag }); assert.equal((await call(deps)).status, 404, String(flag)); untouched(spy); }
});

test("a missing, short, repetitive or reused secret makes the feature absent (404), even for a caller who presents it", async () => {
  for (const secret of [undefined, "", "   ", "short", "a".repeat(31), "a".repeat(64), "ab".repeat(32), "1234567".repeat(8), "abcdefghijklmnopqrstuvwxyz01234", DISPATCH_SECRET]) {
    const { deps, spy } = setup({ DB_ATTESTATION_SECRET: secret }); const r = await call(deps, post(`Bearer ${secret ?? ""}`)); assert.equal(r.status, 404, JSON.stringify(secret)); untouched(spy);
  }
  const { deps } = setup({ DB_ATTESTATION_SECRET: "x1y2z3w4".repeat(4) }); assert.equal((await call(deps, post(`Bearer ${"x1y2z3w4".repeat(4)}`))).status, 200, "a 32-character secret with enough variety is accepted");
});

test("wrong or missing credentials answer 401 and never touch a database", async () => {
  // (A leading or trailing space is not tested: the Fetch API trims header values, so it would be the valid header.)
  const wrong: (string | null)[] = [null, "", "Bearer", "Bearer ", "Bearer wrong", `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(0, -1)}`, `bearer ${SECRET}`, `Basic ${SECRET}`, SECRET, `Bearer  ${SECRET}`, `Bearer\t${SECRET}`, `Bearer ${SECRET.toUpperCase()}`, `Bearer ${DISPATCH_SECRET}`, `Bearer ${"s".repeat(SECRET.length)}`];
  for (const auth of wrong) {
    const { deps, spy } = setup(); const r = await call(deps, post(auth)); assert.equal(r.status, 401, JSON.stringify(auth)); assert.deepEqual(r.body, { error: "unauthorized" });
    untouched(spy); assert.equal(spy.resolves, 0); assert.ok(!spy.trace.includes("configuration"), "the configuration is not even evaluated for an unauthorised caller");
  }
});

test("a database access attempt before the token is verified would be caught: every dependency throws if reached", async () => {
  const boom = () => { throw new Error("reached a database dependency before authorisation"); };
  for (const auth of [null, "", "Bearer wrong", "Basic abc"]) {
    const deps: DbAttestationDeps = { env: env(), resolveUrl: boom, scopedCheckoutEnabled: boom, connect: async () => boom() };
    assert.equal((await call(deps, post(auth))).status, 401);
  }
  assert.equal((await call({ env: env({ VERCEL_ENV: "production" }), resolveUrl: boom, scopedCheckoutEnabled: boom, connect: async () => boom() }, post())).status, 404);
  // Control: with a valid token, a throwing dependency is still a closed door: a flag parser that throws is "not ready", and nothing is connected.
  const flagThrows = await call({ env: env(), resolveUrl: boom, scopedCheckoutEnabled: boom, connect: async () => boom() }, post());
  assert.equal(flagThrows.status, 503); assert.deepEqual(flagThrows.body, { ok: false, status: "not_ready", reasons: ["CHECKOUT_SCOPED_DB_ENABLED_invalid"] });
  // ... and anything the handler did not foresee ends in the outermost catch with one fixed word, never the thrown message.
  const spy = setup(); const unforeseen = await call({ ...spy.deps, trace: () => { throw new Error(`unexpected ${SECRET} ${PW.owner}`); } }, post());
  assert.equal(unforeseen.status, 503); assert.deepEqual(unforeseen.body, { ok: false, status: "unavailable" }); untouched(spy.spy);
});

test("only POST: other methods with a valid token are 405 (and Allow says POST)", async () => {
  for (const method of ["GET", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) { const { deps, spy } = setup(); const r = await call(deps, post(undefined, method)); assert.equal(r.status, 405, method); assert.equal(r.headers.get("allow"), "POST"); untouched(spy); }
});

test("every method without a valid token is 401 in Preview (OPTIONS and HEAD included), never a framework answer", async () => {
  for (const method of ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]) { const { deps, spy } = setup(); const r = await call(deps, post(null, method)); assert.equal(r.status, 401, method); untouched(spy); }
});

test("an inconsistent or incomplete Neon identity configuration is not ready, and no database is contacted", async () => {
  const cases: [string, Record<string, string | undefined>, string][] = [
    ["wrong Neon branch", { NEON_BRANCH_ID: "br-someone-else-1234" }, "branch_mismatch"],
    ["no branch at all", { NEON_BRANCH_ID: undefined }, "NEON_BRANCH_ID_invalid"], ["no expected branch", { EXPECTED_NEON_PREVIEW_BRANCH_ID: undefined }, "EXPECTED_NEON_PREVIEW_BRANCH_ID_invalid"],
    ["a malformed branch", { NEON_BRANCH_ID: "main", EXPECTED_NEON_PREVIEW_BRANCH_ID: "main" }, "NEON_BRANCH_ID_invalid"],
    ["the preview branch is the production branch", { EXPECTED_NEON_PRODUCTION_BRANCH_ID: "br-nameless-mountain-awib28a9" }, "branch_is_production"],
    ["a malformed production branch id", { EXPECTED_NEON_PRODUCTION_BRANCH_ID: "prod" }, "EXPECTED_NEON_PRODUCTION_BRANCH_ID_invalid"],
    ["no expected endpoint", { EXPECTED_NEON_PREVIEW_ENDPOINT_ID: undefined }, "EXPECTED_NEON_PREVIEW_ENDPOINT_ID_invalid"],
    ["a branch id used as the endpoint", { EXPECTED_NEON_PREVIEW_ENDPOINT_ID: "br-nameless-mountain-awib28a9" }, "EXPECTED_NEON_PREVIEW_ENDPOINT_ID_invalid"],
    ["no expected database", { EXPECTED_PREVIEW_DB_NAME: undefined }, "EXPECTED_PREVIEW_DB_NAME_invalid"],
    ["no expected storefront role", { EXPECTED_PREVIEW_STOREFRONT_DB_ROLE: undefined }, "EXPECTED_PREVIEW_STOREFRONT_DB_ROLE_invalid"],
    ["the same role for both scopes", { EXPECTED_PREVIEW_ADMIN_DB_ROLE: "ege_preview_storefront" }, "expected_roles_not_distinct"],
    ["an owner role as the admin role", { EXPECTED_PREVIEW_ADMIN_DB_ROLE: "neondb_owner" }, "expected_role_forbidden"],
    ["a malformed checkout flag", { CHECKOUT_SCOPED_DB_ENABLED: "yes" }, "CHECKOUT_SCOPED_DB_ENABLED_invalid"],
  ];
  for (const [name, over, reason] of cases) {
    const { deps, spy } = setup(over); const r = await call(deps);
    assert.equal(r.status, 503, name); assert.equal(r.body.status, "not_ready"); assert.ok(r.body.reasons.includes(reason), `${name}: ${JSON.stringify(r.body.reasons)}`); untouched(spy); assert.equal(spy.resolves, 0);
  }
  assert.deepEqual(configurationProblems(env(), scopedCheckoutEnabled), []);
});

test("a wrong Neon endpoint is refused BEFORE any connection is opened", async () => {
  const other = "ep-other-endpoint-9z9z9z9z-pooler.eu-central-1.aws.neon.tech";
  const bothWrong = env({ DATABASE_URL: env().DATABASE_URL!.replace(HOST, other), STOREFRONT_DATABASE_URL: env().STOREFRONT_DATABASE_URL!.replace(HOST, other), ADMIN_DATABASE_URL: env().ADMIN_DATABASE_URL!.replace(HOST, other) });
  const { deps, spy } = setup(bothWrong); const r = await call(deps);
  assert.equal(r.status, 422); assert.deepEqual(r.body.storefront, { status: "rejected", reasons: ["url_endpoint_mismatch"] }); assert.deepEqual(r.body.admin, { status: "rejected", reasons: ["url_endpoint_mismatch"] }); assert.equal(r.body.ok, false);
  untouched(spy);   // not a connection, not a query, not even a close: the wrong endpoint was never dialled
  // A scoped URL on another endpoint than the legacy connection never even reaches a session. The existing scope guard judges BOTH scoped URLs together,
  // so one inconsistent URL rejects both scopes (the conservative reading), and no session is opened for either.
  const split = setup({ STOREFRONT_DATABASE_URL: env().STOREFRONT_DATABASE_URL!.replace(HOST, other) }); const s = await call(split.deps);
  assert.equal(s.status, 422); assert.deepEqual(s.body.storefront, { status: "rejected", reasons: ["scoped_url_invalid"] }); assert.deepEqual(s.body.admin, { status: "rejected", reasons: ["scoped_url_invalid"] }); assert.equal(split.spy.connects.length, 0);
  // A non-Neon host is no endpoint at all.
  const local = env({ DATABASE_URL: env().DATABASE_URL!.replace(HOST, "db.example.test"), STOREFRONT_DATABASE_URL: env().STOREFRONT_DATABASE_URL!.replace(HOST, "db.example.test"), ADMIN_DATABASE_URL: env().ADMIN_DATABASE_URL!.replace(HOST, "db.example.test") });
  const localRun = setup(local); assert.deepEqual((await call(localRun.deps)).body.storefront.reasons, ["url_host_not_neon"]); untouched(localRun.spy);
});

test("both scoped URLs are judged BEFORE either scope connects: one bad URL means no connection at all", async () => {
  // The admin URL is consistent with the legacy one (so the scoped-URL guard passes), but its role is not the expected admin role.
  const bad = setup({ EXPECTED_PREVIEW_ADMIN_DB_ROLE: "ege_preview_someone_else" }); const r = await call(bad.deps);
  assert.equal(r.status, 422); assert.deepEqual(r.body.admin, { status: "rejected", reasons: ["url_role_unexpected"] });
  assert.deepEqual(r.body.storefront, { status: "skipped", reasons: ["other_scope_rejected"] }, "the good storefront URL was not dialled either");
  untouched(bad.spy); assert.equal(bad.spy.resolves, 2, "both URLs were resolved and judged"); assert.deepEqual(bad.spy.trace, ["environment", "feature", "secret", "authorization", "method", "configuration", "urls"], "and nothing after the URL phase ran");
  // The same the other way round.
  const bad2 = setup({ EXPECTED_PREVIEW_STOREFRONT_DB_ROLE: "ege_preview_someone_else" }); const r2 = await call(bad2.deps);
  assert.deepEqual([r2.body.storefront.status, r2.body.admin.status], ["rejected", "skipped"]); untouched(bad2.spy);
});

test("URLs that name the wrong role (swapped) or carry parameters that reconfigure the driver are refused with zero connections", async () => {
  const swapped = setup({ STOREFRONT_DATABASE_URL: env().ADMIN_DATABASE_URL, ADMIN_DATABASE_URL: env().STOREFRONT_DATABASE_URL }); const r = await call(swapped.deps);
  assert.equal(r.status, 422); assert.deepEqual(r.body.storefront, { status: "rejected", reasons: ["url_role_unexpected"] }); assert.deepEqual(r.body.admin, { status: "rejected", reasons: ["url_role_unexpected"] }); untouched(swapped.spy);
  // These pass the legacy checks the scoped-URL guard makes only if they are well formed; the ones it lets through are stopped by the pre-connect guard.
  for (const [name, over] of [["a host override", "?sslmode=verify-full&host=evil.example"], ["TLS off", "?ssl=0"], ["verification off", "?sslmode=no-verify"], ["a user override", "?sslmode=verify-full&user=neondb_owner"], ["a duplicate sslmode", "?sslmode=require&sslmode=verify-full"]] as const) {
    const run = setup({ STOREFRONT_DATABASE_URL: env().STOREFRONT_DATABASE_URL!.replace("?sslmode=verify-full", over) }); const x = await call(run.deps);
    assert.equal(x.status, 422, name); assert.ok(x.body.storefront.status === "rejected" && x.body.admin.status === "rejected", name); untouched(run.spy);
  }
});

test("the pre-connect guard stands on its own: even if the scoped-URL guard were absent, a hostile URL is refused with zero connections", async () => {
  // resolveUrl is replaced by a pass-through, so only the pre-connect guard stands between these strings and a connection.
  const passThrough: DbAttestationDeps["resolveUrl"] = (scope, vars) => vars[scope === "storefront" ? "STOREFRONT_DATABASE_URL" : "ADMIN_DATABASE_URL"]!;
  const base = env().STOREFRONT_DATABASE_URL!;
  const cases: [string, string, string][] = [
    ["a host override", base.replace("?sslmode=verify-full", "?sslmode=verify-full&host=evil.example"), "url_params_unsupported"], ["TLS off", base.replace("?sslmode=verify-full", "?ssl=0"), "url_params_unsupported"],
    ["no certificate verification", base.replace("verify-full", "no-verify"), "url_params_unsupported"], ["an encoded sslmode=disable", base.replace("?sslmode=verify-full", "?%73slmode=disable"), "url_params_unsupported"],
    ["a duplicate sslmode", base.replace("?sslmode=verify-full", "?sslmode=require&sslmode=verify-full"), "url_params_unsupported"], ["a foreign host", base.replace(HOST, "evil.example"), "url_host_not_neon"],
    ["the Neon name in the userinfo", `postgresql://ege_preview_storefront:${ENDPOINT}.eu-central-1.aws.neon.tech@evil.example/neondb`, "url_host_not_neon"], ["a percent-encoded dot in the host", base.replace(HOST, `${ENDPOINT}%2eeu-central-1.aws.neon.tech`), "url_host_not_neon"],
    ["another endpoint", base.replace(HOST, "ep-other-endpoint-9z9z9z9z.eu-central-1.aws.neon.tech"), "url_endpoint_mismatch"], ["another database", base.replace("/neondb", "/postgres"), "url_database_unexpected"],
    ["an encoded slash in the database", base.replace("/neondb", "/neondb%2Fx"), "url_database_unexpected"], ["another role", base.replace("ege_preview_storefront", "neondb_owner"), "url_role_unexpected"],
  ];
  for (const [name, hostile, reason] of cases) {
    const run = setup({ STOREFRONT_DATABASE_URL: hostile }); run.deps.resolveUrl = (scope, vars) => { run.spy.resolves++; return passThrough(scope, vars); };
    const r = await call(run.deps); assert.equal(r.status, 422, name); assert.ok(r.body.storefront.reasons.includes(reason), `${name}: ${JSON.stringify(r.body.storefront.reasons)}`);
    assert.deepEqual(r.body.admin, { status: "skipped", reasons: ["other_scope_rejected"] }, `${name}: the good admin URL is not dialled either`); untouched(run.spy);
  }
});

test("the URL-rejection answer reports the checkout flag truthfully, like every other answer", async () => {
  for (const [flag, expected] of [["true", "flag_enabled"], ["false", "not_enabled"], [undefined, "not_enabled"]] as const) {
    const run = setup({ EXPECTED_PREVIEW_DB_NAME: "postgres", CHECKOUT_SCOPED_DB_ENABLED: flag }); const r = await call(run.deps);
    assert.equal(r.status, 422); assert.equal(r.body.checkoutActivation, expected, String(flag)); assert.equal(r.body.ok, false, "and it is never ok"); untouched(run.spy);
  }
});

test("percent-encoded role and database that decode to the expected ones are accepted, exactly like the driver reads them", async () => {
  const enc = (s: string) => s.replace("ege_preview_storefront", "ege%5Fpreview%5Fstorefront");
  const run = setup({ STOREFRONT_DATABASE_URL: enc(env().STOREFRONT_DATABASE_URL!) }); const r = await call(run.deps);
  assert.equal(r.status, 200); assert.equal(run.spy.connects.length, 2);
});

test("a process that does not verify TLS certificates is reported as not ready, and nothing is connected", async () => {
  for (const value of ["0", " 0 "]) { const run = setup({ NODE_TLS_REJECT_UNAUTHORIZED: value }); const r = await call(run.deps); assert.equal(r.status, 503, value); assert.ok(r.body.reasons.includes("tls_verification_disabled")); untouched(run.spy); assert.equal(run.spy.resolves, 0); }
  for (const value of [undefined, "1", ""]) assert.equal((await call(setup({ NODE_TLS_REJECT_UNAUTHORIZED: value }).deps)).status, 200, String(value));
});

test("a session whose role is not the expected one is rejected (wrong role, switched role, broad role)", async () => {
  const cases: [string, (t: { role: string; database: string }, scope: string) => unknown, string[]][] = [
    ["the admin role behind the storefront scope", (t, scope) => (scope === "storefront" ? { role_name: "ege_preview_admin", session_name: "ege_preview_admin", database_name: t.database } : { role_name: t.role, session_name: t.role, database_name: t.database }), ["role_mismatch", "url_role_mismatch"]],
    ["SET ROLE: current_user differs from session_user", (t, scope) => (scope === "storefront" ? { role_name: t.role, session_name: "someone_else", database_name: t.database } : { role_name: t.role, session_name: t.role, database_name: t.database }), ["role_switched", "role_mismatch", "url_role_mismatch"]],
    ["the owner role", (t, scope) => (scope === "storefront" ? { role_name: "neondb_owner", session_name: "neondb_owner", database_name: t.database } : { role_name: t.role, session_name: t.role, database_name: t.database }), ["forbidden_role", "role_mismatch", "url_role_mismatch"]],
  ];
  for (const [name, answer, reasons] of cases) {
    const { deps } = setup({}, { answer }); const r = await call(deps);
    assert.equal(r.status, 422, name); assert.deepEqual(r.body.storefront, { status: "rejected", reasons }, name); assert.equal(r.body.admin.status, "verified", `${name}: the admin scope is judged on its own`); assert.equal(r.body.ok, false);
  }
});

test("a session on the wrong database is rejected", async () => {
  const { deps } = setup({}, { answer: (t) => ({ role_name: t.role, session_name: t.role, database_name: "postgres" }) });
  const r = await call(deps); assert.equal(r.status, 422); assert.deepEqual(r.body.storefront.reasons, ["database_mismatch", "url_database_mismatch"]); assert.deepEqual(r.body.admin.reasons, ["database_mismatch", "url_database_mismatch"]);
  const wrongUrlDb = env({ DATABASE_URL: env().DATABASE_URL!.replace("/neondb", "/other"), STOREFRONT_DATABASE_URL: env().STOREFRONT_DATABASE_URL!.replace("/neondb", "/other"), ADMIN_DATABASE_URL: env().ADMIN_DATABASE_URL!.replace("/neondb", "/other") });
  const wrongRun = setup(wrongUrlDb); const w = await call(wrongRun.deps);
  assert.equal(w.status, 422); assert.deepEqual(w.body.storefront.reasons, ["url_database_unexpected"]); untouched(wrongRun.spy);   // refused before any connection
});

test("a connection failure is 503 'unavailable' with a fixed code and no driver text", async () => {
  const connect = async () => { throw Object.assign(new Error(`connect ECONNREFUSED ${HOST} password authentication failed for user "ege_preview_storefront" ${PW.store}`), { code: "ECONNREFUSED" }); };
  const { deps, spy } = setup({}, { connect }); const r = await call(deps);
  assert.equal(r.status, 503); assert.deepEqual(r.body.storefront, { status: "unavailable", reasons: ["connection_failed"] }); assert.deepEqual(r.body.admin, { status: "unavailable", reasons: ["connection_failed"] }); assert.equal(r.body.ok, false);
  assert.equal(spy.connects.length, 2);
});

test("a SQL error and a SQL timeout fail closed within the bound", async () => {
  const failing: DbAttestationDeps["timeouts"] = { queryMs: 60, connectMs: 60, totalMs: 1500 };
  const sqlError = setup({}, { timeouts: failing, connect: async () => ({ query: async () => { throw new Error('relation "x" does not exist: SELECT secret'); }, close: async () => {} }) });
  const e = await call(sqlError.deps); assert.equal(e.status, 503); assert.deepEqual(e.body.storefront, { status: "unavailable", reasons: ["identity_query_failed"] });
  let closed = 0; const started = Date.now();
  const hang = setup({}, { timeouts: failing, connect: async () => ({ query: () => new Promise(() => {}), close: async () => { closed++; } }) });
  const t = await call(hang.deps); assert.equal(t.status, 503); assert.deepEqual(t.body.storefront, { status: "unavailable", reasons: ["identity_timeout"] }); assert.deepEqual(t.body.admin, { status: "unavailable", reasons: ["identity_timeout"] });
  assert.ok(Date.now() - started < 1000, "bounded: it did not wait for the hanging session"); assert.equal(closed, 2, "the hanging sessions were closed");
});

test("a session whose close never returns neither hangs the request nor changes the verdict", async () => {
  const started = Date.now();
  const { deps } = setup({}, { timeouts: { queryMs: 200, connectMs: 200, closeMs: 60, totalMs: 3000 }, connect: async (url) => {
    const t = connectionTarget(url)!; return { query: async () => ({ rows: [{ role_name: t.role, session_name: t.role, database_name: t.database }] }), close: () => new Promise<void>(() => {}) };
  } });
  const r = await call(deps); assert.equal(r.status, 200); assert.equal(r.body.ok, true); assert.ok(Date.now() - started < 1500, "bounded despite two sessions that never close");
});

test("the total deadline is a HARD cap: slow steps cannot stretch the response past it (a stalled close included)", async () => {
  // Query and close both hang. The query is cut at the deadline, but a close that is only bounded by closeMs would add closeMs on top for each session.
  const started = Date.now();
  const { deps } = setup({}, { timeouts: { connectMs: 1000, queryMs: 5000, closeMs: 500, totalMs: 150 }, connect: async () => ({ query: () => new Promise(() => {}), close: () => new Promise<void>(() => {}) }) });
  const r = await call(deps); const elapsed = Date.now() - started;
  assert.equal(r.status, 503); assert.deepEqual(r.body, { ok: false, status: "unavailable" }, "the request ended at the deadline, with one fixed word");
  assert.ok(elapsed < 400, `answered at the deadline (took ${elapsed} ms; without the hard cap it would take about 150 + 500 ms)`);
});

test("a connect that hangs is cut off, and a session that opens after the deadline is still closed", async () => {
  let closed = 0, release: (s: AttestationSession) => void = () => {};
  const late = new Promise<AttestationSession>((resolve) => { release = resolve; });
  const { deps } = setup({}, { timeouts: { connectMs: 40, queryMs: 40, totalMs: 1500 }, connect: () => late });
  const r = await call(deps); assert.equal(r.status, 503); assert.deepEqual(r.body.storefront.reasons, ["connection_timeout"]);
  release({ query: async () => ({ rows: [] }), close: async () => { closed++; } }); await new Promise((x) => setTimeout(x, 20)); assert.ok(closed >= 1, "the late session was closed, not leaked");
  const overall = setup({}, { timeouts: { connectMs: 5000, queryMs: 5000, totalMs: 80 }, connect: () => new Promise(() => {}) }); const started = Date.now();
  const o = await call(overall.deps); assert.equal(o.status, 503); assert.ok(Date.now() - started < 1000, "the whole request is bounded");
});

test("checkout flag false or absent: the identities are reported but the activation is NOT verified", async () => {
  for (const flag of [undefined, "", "false"]) {
    const { deps } = setup({ CHECKOUT_SCOPED_DB_ENABLED: flag }); const r = await call(deps);
    assert.equal(r.status, 409, String(flag)); assert.equal(r.body.ok, false); assert.equal(r.body.checkoutActivation, "not_enabled"); assert.equal(r.body.storefront.status, "verified"); assert.equal(r.body.admin.status, "verified");
  }
  const rejected = await call(setup({ CHECKOUT_SCOPED_DB_ENABLED: "false" }, { answer: (t) => ({ role_name: "neondb_owner", session_name: "neondb_owner", database_name: t.database }) }).deps);
  assert.equal(rejected.status, 422, "a rejected identity outranks the flag");
});

test("a 200 never claims more than it proves: no field says the checkout path was verified", async () => {
  const ok = await call(setup().deps); assert.equal(ok.status, 200);
  assert.ok(["flag_enabled", "not_enabled"].includes(String(ok.body.checkoutActivation)), "'checkoutActivation' only reports the flag");
  assert.doesNotMatch(String(ok.body.checkoutActivation), /verified|proven|active/i);
  assert.deepEqual(Object.keys(ok.body).sort(), ["admin", "checkoutActivation", "ok", "storefront"], "no other field could be read as a claim about checkout");
  assert.match(readFileSync("lib/db-attestation-handler.ts", "utf8"), /It is NOT evidence that checkout requests run on those connections/, "the limit is written next to the code");
});

test("responses are fixed words: every body, over every outcome, uses only an allow-listed shape", async () => {
  const ok = await call(setup().deps), words = new Set<string>();
  const walk = (value: unknown) => { if (typeof value === "string") words.add(value); else if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === "object") Object.values(value).forEach(walk); };
  walk(ok.body); walk((await call(setup({ CHECKOUT_SCOPED_DB_ENABLED: "false" }).deps)).body); walk((await call(setup({}, { answer: (t) => ({ role_name: "x", session_name: "y", database_name: t.database }) }).deps)).body);
  for (const w of words) assert.match(w, /^[a-z_]{2,40}$|^[A-Za-z0-9_]{2,64}$/, "only fixed lower-case words and reason codes");
});

test("the secret is compared in constant time on digests, and an unequal length never throws", () => {
  assert.equal(sameSecret(SECRET, SECRET), true); assert.equal(sameSecret("a", SECRET), false); assert.equal(sameSecret("", SECRET), false); assert.equal(sameSecret(`${SECRET}${SECRET}`, SECRET), false);
  const source = readFileSync("lib/db-attestation-handler.ts", "utf8");
  assert.match(source, /timingSafeEqual\(digest\(presented\), digest\(secret\)\)/); assert.doesNotMatch(source, /presented\s*[!=]==|[!=]==\s*presented/, "the presented token is never compared with a plain operator");
});

test("route wiring: Node.js runtime, no Edge, every method through the one handler, nothing logged, checkout wiring untouched", () => {
  const route = readFileSync("app/api/internal/db-attestation/route.ts", "utf8");
  assert.match(route, /export const runtime = "nodejs";/); assert.doesNotMatch(route, /runtime\s*=\s*["']edge["']/); assert.match(route, /export const dynamic = "force-dynamic";/);
  for (const m of ["POST", "GET", "PUT", "PATCH", "DELETE", "OPTIONS"]) assert.match(route, new RegExp(`export const ${m} = handle;`), `${m} is handled (404 when absent, never a framework answer that reveals the route: Next.js would answer OPTIONS itself with an Allow list)`);
  assert.doesNotMatch(route, /console\.|\.log\(|process\.stdout/, "logs nothing"); assert.match(route, /rejectUnauthorized: true/, "certificate-verifying TLS, like db\/index.ts");
  assert.doesNotMatch(route, /from "@\/db"|getScopedPool|getPool|getDb/, "never borrows the checkout pools");
  assert.match(route, /connectionString: target\.toString\(\), ssl: \{ rejectUnauthorized: true \}/); assert.match(route, /target\.searchParams\.delete\("sslmode"\)/, "the URL's sslmode cannot replace the pinned TLS option");
  assert.match(route, /env: process\.env/);
  const db = readFileSync("db/index.ts", "utf8"); assert.doesNotMatch(db, /db-attestation|db-runtime-attestation/, "db/index.ts and the checkout path are unchanged");
  for (const f of ["lib/db-access-scope.ts"]) assert.doesNotMatch(readFileSync(f, "utf8"), /db-attestation/, f);
});

test("the global proxy: a bearer-authorised POST must carry a same-origin Origin header (the shared CSRF policy is not weakened for this route)", () => {
  assert.equal(requiresSameOrigin("/api/internal/db-attestation"), true, "no exemption was added");
  assert.equal(isSameOrigin("https://preview.example.test", "preview.example.test"), true); assert.equal(isSameOrigin(null, "preview.example.test"), false); assert.equal(isSameOrigin("https://evil.example", "preview.example.test"), false);
  assert.doesNotMatch(readFileSync("lib/security-policy.ts", "utf8"), /db-attestation/);
});
