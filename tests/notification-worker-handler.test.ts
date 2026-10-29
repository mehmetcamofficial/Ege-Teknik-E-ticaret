/** PR #37 behaviour tests for the dispatch endpoint's logic, the worker identity guard, SQLSTATE logging and the sweep window. No database, no network. */
import assert from "node:assert/strict";
import test from "node:test";
import { handleDispatch, type DispatchDeps } from "../lib/notifications/dispatch-handler.ts";
import { sqlStateOf } from "../lib/notifications/sqlstate.ts";
import { DEFAULT_SWEEP_WINDOW_MINUTES, MAX_SWEEP_WINDOW_MINUTES, sweepBounds } from "../lib/notifications/sweep-window.ts";
import { WorkerIdentityError, assertNotificationWorkerIdentity, workerIdentityViolations, type WorkerIdentity } from "../lib/notifications/worker-identity.ts";

const SECRET = "s".repeat(40);
type Calls = { db: number; attest: number; provider: number; run: number; logs: { event: string; fields: Record<string, string> }[] };
function setup(over: Partial<DispatchDeps<object, object>> = {}, env: Record<string, string | undefined> = {}) {
  const calls: Calls = { db: 0, attest: 0, provider: 0, run: 0, logs: [] };
  const deps: DispatchDeps<object, object> = {
    env: { NOTIFICATION_DISPATCH_SECRET: SECRET, ORDER_ALERT_EMAILS: "ops@example.test", ...env },
    parseRecipients: (v) => (v ?? "").split(",").map((x) => x.trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[a-z]+$/.test(x)),
    getWorkerDb: () => { calls.db++; return {}; },
    attest: async () => { calls.attest++; },
    makeProvider: () => { calls.provider++; return {}; },
    run: async () => { calls.run++; return { swept: 0, processed: 2, sent: 2, retried: 0, dead: 0, providerConfigured: true }; },
    logError: (event, fields) => { calls.logs.push({ event, fields }); },
    ...over,
  };
  return { deps, calls };
}
const req = (auth?: string) => new Request("http://x.test/api/internal/notifications/dispatch", { headers: auth ? { authorization: auth } : {} });
const body = async (r: Response) => JSON.parse(await r.text());

test("dispatch: feature absent (no or short secret) answers 404 and touches nothing", async () => {
  for (const secret of [undefined, "", "short"]) {
    const { deps, calls } = setup({}, { NOTIFICATION_DISPATCH_SECRET: secret });
    const r = await handleDispatch(req(`Bearer ${SECRET}`), deps);
    assert.equal(r.status, 404); assert.deepEqual(await body(r), { error: "not_configured" });
    assert.deepEqual([calls.db, calls.attest, calls.provider, calls.run], [0, 0, 0, 0]);
  }
});

test("dispatch: wrong, missing, malformed or different-length credentials answer 401 before any database access", async () => {
  for (const auth of [undefined, "", "Bearer ", "Bearer wrong", `Bearer ${"x".repeat(40)}`, `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(1)}`, `Basic ${SECRET}`, SECRET]) {
    const { deps, calls } = setup();
    const r = await handleDispatch(req(auth), deps);
    assert.equal(r.status, 401, String(auth)); assert.deepEqual(await body(r), { error: "unauthorized" });
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.deepEqual([calls.db, calls.attest, calls.provider, calls.run], [0, 0, 0, 0], "no connection is opened for an unauthorized caller");
  }
});

test("dispatch: ORDER_ALERT_EMAILS is mandatory; without a valid recipient the answer is 503 and no database connection is made", async () => {
  for (const emails of [undefined, "", "   ", "not-an-address, also bad"]) {
    const { deps, calls } = setup({}, { ORDER_ALERT_EMAILS: emails });
    const r = await handleDispatch(req(`Bearer ${SECRET}`), deps);
    assert.equal(r.status, 503); assert.deepEqual(await body(r), { error: "not_configured" });
    assert.deepEqual([calls.db, calls.attest, calls.run], [0, 0, 0], "no admin_users fallback, no worker connection");
  }
});

test("dispatch: a correct call attests the identity first, then runs the worker with counts only", async () => {
  const order: string[] = [];
  const { deps } = setup({ getWorkerDb: () => { order.push("db"); return {}; }, attest: async () => { order.push("attest"); }, run: async () => { order.push("run"); return { swept: 1, processed: 3, sent: 2, retried: 1, dead: 0, providerConfigured: true }; } });
  const r = await handleDispatch(req(`Bearer ${SECRET}`), deps);
  assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await body(r), { ok: true, swept: 1, processed: 3, sent: 2, retried: 1, dead: 0, providerConfigured: true });
  assert.deepEqual(order, ["db", "attest", "run"]);
});

test("dispatch: every failure is a generic 503 and only a fixed code is logged, never a message, URL, role or password", async () => {
  const leaky = Object.assign(new Error("password authentication failed for user \"sprintb_worker\" at postgresql://sprintb_worker:TOPSECRET@db.example.test/neondb"), { code: "28P01" });
  const wrapped = Object.assign(new Error("Failed query: select * from orders where email = 'victim@example.test'"), { cause: Object.assign(new Error("permission denied for table orders"), { code: "42501" }) });
  const cases: [string, DispatchDeps<object, object>["getWorkerDb"] | null, Partial<DispatchDeps<object, object>>, string][] = [
    ["config error from the URL guard", () => { throw new Error("Notification worker requires four distinct database roles."); }, {}, "unknown"],
    ["driver error with a leaky message", () => { throw leaky; }, {}, "28P01"],
    ["drizzle-wrapped error: the SQLSTATE is read from the cause", null, { run: async () => { throw wrapped; } }, "42501"],
    ["identity rejected", null, { attest: async () => { throw new WorkerIdentityError(["superuser"]); } }, "identity"],
    ["non-error throw", () => { throw "TOPSECRET"; }, {}, "unknown"],
  ];
  for (const [label, getWorkerDb, over, code] of cases) {
    const { deps, calls } = setup({ ...(getWorkerDb ? { getWorkerDb } : {}), ...over });
    const r = await handleDispatch(req(`Bearer ${SECRET}`), deps);
    const text = await r.text();
    assert.equal(r.status, 503, label); assert.deepEqual(JSON.parse(text), { error: "worker_unavailable" }, label);
    assert.deepEqual(calls.logs, [{ event: "notification_dispatch_unavailable", fields: { code } }], label);
    const everything = text + JSON.stringify(calls.logs);
    assert.doesNotMatch(everything, /TOPSECRET|sprintb_worker|victim@|password|postgresql:|permission denied|select \*/i, label);
  }
});

test("sqlStateOf returns only a 5-character SQLSTATE and looks through at most three levels of cause", () => {
  assert.equal(sqlStateOf({ code: "42501" }), "42501");
  assert.equal(sqlStateOf({ message: "x", cause: { cause: { code: "23505" } } }), "23505");
  assert.equal(sqlStateOf({ cause: { cause: { cause: { code: "42501" } } } }), "unknown", "depth is bounded");
  for (const bad of [{ code: "ECONNREFUSED" }, { code: "42501 extra" }, { code: 42501 }, { code: "4250" }, "42501", null, undefined, 7]) assert.equal(sqlStateOf(bad), "unknown");
});

const okIdentity: WorkerIdentity = { role_name: "w", session_name: "w", rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false,
  touches_admin_users: false, create_in_database: false, create_in_public: false, set_role_memberships: "0" };
test("worker identity: only a least-privilege identity is accepted; each over-privilege has its own fixed reason", () => {
  assert.deepEqual(workerIdentityViolations(okIdentity), []);
  assert.deepEqual(workerIdentityViolations(undefined), ["identity_unreadable"]);
  const cases: [Partial<WorkerIdentity>, string][] = [
    [{ rolsuper: true }, "superuser"], [{ rolbypassrls: true }, "bypassrls"], [{ rolcreaterole: true }, "createrole"], [{ rolcreatedb: true }, "createdb"],
    [{ rolreplication: true }, "replication"], [{ touches_admin_users: true }, "admin_users_access"], [{ create_in_database: true }, "create_in_database"],
    [{ create_in_public: true }, "create_in_public"], [{ set_role_memberships: 1 }, "set_role_membership"], [{ set_role_memberships: "2" }, "set_role_membership"], [{ session_name: "owner" }, "role_switched"],
  ];
  for (const [over, reason] of cases) assert.deepEqual(workerIdentityViolations({ ...okIdentity, ...over }), [reason]);
});

test("worker identity: a failed check is never cached as success, a passed check is asked once per process", async () => {
  const g = globalThis as unknown as { egeTeknikWorkerIdentityOk?: boolean };
  delete g.egeTeknikWorkerIdentityOk;
  let asked = 0;
  await assert.rejects(assertNotificationWorkerIdentity(async () => { asked++; return { ...okIdentity, rolsuper: true }; }), WorkerIdentityError);
  await assert.rejects(assertNotificationWorkerIdentity(async () => { asked++; return undefined; }), WorkerIdentityError);
  assert.equal(g.egeTeknikWorkerIdentityOk, undefined, "failures leave the process unattested");
  await assertNotificationWorkerIdentity(async () => { asked++; return okIdentity; });
  await assertNotificationWorkerIdentity(async () => { asked++; throw new Error("must not be asked again"); });
  assert.equal(asked, 3);
  delete g.egeTeknikWorkerIdentityOk;
});

const NOW = new Date("2026-10-24T12:00:00.000Z");
const minutesAgo = (d: Date) => Math.round((NOW.getTime() - d.getTime()) / 60_000);
test("sweep window: default is 30 minutes; a longer window needs a valid go-live floor and is bounded; anything invalid is the default", () => {
  const def = sweepBounds({}, NOW);
  assert.equal(minutesAgo(def.since), DEFAULT_SWEEP_WINDOW_MINUTES); assert.equal(def.floor, null); assert.equal((NOW.getTime() - def.settled.getTime()) / 1000, 60);
  const floor = "2026-10-23T00:00:00.000Z";
  const ok = sweepBounds({ NOTIFICATION_SWEEP_WINDOW_MINUTES: "2880", NOTIFICATION_SWEEP_NOT_BEFORE: floor }, NOW);
  assert.equal(ok.windowMinutes, 2880); assert.equal(ok.since.toISOString(), floor, "the floor wins over a window that reaches further back");
  assert.equal(minutesAgo(sweepBounds({ NOTIFICATION_SWEEP_WINDOW_MINUTES: "180", NOTIFICATION_SWEEP_NOT_BEFORE: floor }, NOW).since), 180, "the window wins when it is more recent than the floor");
  for (const env of [
    { NOTIFICATION_SWEEP_WINDOW_MINUTES: "180" },                                                                    // window without a floor: would mail history
    { NOTIFICATION_SWEEP_NOT_BEFORE: floor },                                                                         // floor alone does not widen anything
    { NOTIFICATION_SWEEP_WINDOW_MINUTES: "180", NOTIFICATION_SWEEP_NOT_BEFORE: "not-a-date" },
    { NOTIFICATION_SWEEP_WINDOW_MINUTES: "180", NOTIFICATION_SWEEP_NOT_BEFORE: "1" },                                 // Date.parse reads this as year 2001
    { NOTIFICATION_SWEEP_WINDOW_MINUTES: "180", NOTIFICATION_SWEEP_NOT_BEFORE: "2026" },                              // bare year
    { NOTIFICATION_SWEEP_WINDOW_MINUTES: "180", NOTIFICATION_SWEEP_NOT_BEFORE: "2026-10-01T00:00:00" },               // no zone: server-local time
    { NOTIFICATION_SWEEP_WINDOW_MINUTES: "180", NOTIFICATION_SWEEP_NOT_BEFORE: "2027-01-01T00:00:00Z" },             // floor in the future
    { NOTIFICATION_SWEEP_WINDOW_MINUTES: String(MAX_SWEEP_WINDOW_MINUTES + 1), NOTIFICATION_SWEEP_NOT_BEFORE: floor },
    { NOTIFICATION_SWEEP_WINDOW_MINUTES: "29", NOTIFICATION_SWEEP_NOT_BEFORE: floor },
    { NOTIFICATION_SWEEP_WINDOW_MINUTES: "-5", NOTIFICATION_SWEEP_NOT_BEFORE: floor },
    { NOTIFICATION_SWEEP_WINDOW_MINUTES: "1e3", NOTIFICATION_SWEEP_NOT_BEFORE: floor },
    { NOTIFICATION_SWEEP_WINDOW_MINUTES: "abc", NOTIFICATION_SWEEP_NOT_BEFORE: floor },
  ]) {
    const b = sweepBounds(env, NOW);
    assert.equal(b.windowMinutes, DEFAULT_SWEEP_WINDOW_MINUTES, JSON.stringify(env)); assert.equal(b.floor, null);
    assert.equal(minutesAgo(b.since), DEFAULT_SWEEP_WINDOW_MINUTES);
  }
  assert.equal(minutesAgo(sweepBounds({ NOTIFICATION_SWEEP_WINDOW_MINUTES: String(MAX_SWEEP_WINDOW_MINUTES), NOTIFICATION_SWEEP_NOT_BEFORE: "2026-10-01T00:00:00Z" }, NOW).since), MAX_SWEEP_WINDOW_MINUTES, "the upper bound is accepted");
});
