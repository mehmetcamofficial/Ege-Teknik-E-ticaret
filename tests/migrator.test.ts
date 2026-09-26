import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import pg from "pg";
import {
  CLEANUP_TIMEOUT_MS, CONNECTION_TIMEOUT_MS, EXPECTED_SETTINGS, MigrationGuardError, SESSION_SETTINGS_SQL, assertMigrationEnvironment, closePoolBounded, createMigrationPool, runMigration, safeErrorSummary,
} from "../scripts/migrate-lib.mjs";

/** Phase 3.4A.2: the fail-fast migration runner. Everything runs against fakes - no database, no network. */
const SECRET_PASSWORD = "S3CR3T-pw-9f1c", SECRET_HOST = "ep-secret-host-1234.c-12.us-east-1.aws.neon.tech", SECRET_USER = "secret_user_77";
const direct = `postgresql://${SECRET_USER}:${SECRET_PASSWORD}@${SECRET_HOST}/neondb?sslmode=require`;
const pooler = direct.replace("ep-secret-host-1234.", "ep-secret-host-1234-pooler.");
const PREVIEW = "br-nameless-mountain-awib28a9", PRODUCTION = "br-nameless-grass-aw9qpndy";
const env = (over: Record<string, string | undefined> = {}) => ({ DATABASE_URL_UNPOOLED: direct, MIGRATION_TARGET_ENV: "preview", NEON_BRANCH_ID: PREVIEW, EXPECTED_NEON_PREVIEW_BRANCH_ID: PREVIEW, ...over }) as Record<string, string | undefined>;
const SECRETS = [SECRET_PASSWORD, SECRET_HOST, SECRET_USER, "ep-secret-host-1234", direct];

class FakePool {
  static instances: FakePool[] = [];
  options: Record<string, unknown>;
  applied = false; verified = false; ended = false;
  queries: string[] = []; clientQueries: string[] = [];
  endImpl: () => Promise<void> = async () => {};
  client = { query: async (sql: string) => { this.clientQueries.push(sql); this.applied = sql === SESSION_SETTINGS_SQL; } };
  constructor(options: Record<string, unknown>) { this.options = options; FakePool.instances.push(this); }
  on() { return this; }
  // Faithful to pg-pool: `verify` runs once for the new physical client BEFORE the first query is served.
  async query(sql: string) {
    if (!this.verified) { this.verified = true; await new Promise<void>((resolve, reject) => (this.options.verify as (c: unknown, d: (e?: Error) => void) => void)(this.client, (e) => (e ? reject(e) : resolve()))); }
    this.queries.push(sql);
    return { rows: [{ lock_timeout: this.applied ? EXPECTED_SETTINGS.lock_timeout : "0" }] };
  }
  end() { this.ended = true; return this.endImpl(); }
}
const run = (over: Record<string, unknown> = {}) => {
  FakePool.instances = [];
  const logs: string[] = [];
  const done = runMigration({ env: env(), Pool: FakePool as never, drizzle: ((pool: unknown) => ({ pool })) as never, migrate: (async () => {}) as never, log: (m: string) => logs.push(m), ...over });
  return { done, logs };
};
type VerifyHook = (client: unknown, done: (error?: Error) => void) => void;
const noSecrets = (text: string, where: string) => { for (const s of SECRETS) assert.equal(text.includes(s), false, `${where} leaked a secret value`); };

// ---- guards, before any connection -------------------------------------------------------------
test("a pooler endpoint is rejected before any connection is attempted, without echoing the host", async () => {
  const { done, logs } = run({ env: env({ DATABASE_URL_UNPOOLED: pooler }) });
  await assert.rejects(done, (e: Error) => { assert.ok(e instanceof MigrationGuardError); assert.match(e.message, /pooler endpoint/); noSecrets(e.message, "error"); return true; });
  assert.equal(FakePool.instances.length, 0, "no Pool may even be constructed");
  noSecrets(logs.join("\n"), "logs");
});
test("a direct endpoint is accepted structurally", () => {
  assert.deepEqual(assertMigrationEnvironment(env()), { url: direct, target: "preview", branch: PREVIEW });
});
test("an unparsable URL is rejected with a fixed message (the URL error text would echo the input)", () => {
  for (const bad of ["not a url", "postgres://", "://x"]) assert.throws(() => assertMigrationEnvironment(env({ DATABASE_URL_UNPOOLED: bad })), (e: Error) => { assert.ok(e instanceof MigrationGuardError); assert.equal(e.message.includes(bad), false); return true; });
});
test("Production is rejected: the target needs the explicit acknowledgement, and a Production branch is refused for any other target", () => {
  assert.throws(() => assertMigrationEnvironment(env({ MIGRATION_TARGET_ENV: "production", NEON_BRANCH_ID: PRODUCTION, EXPECTED_NEON_PRODUCTION_BRANCH_ID: PRODUCTION })), /Production migration is blocked/);
  // even if the operator's own "expected" variable is (mis)set to the Production branch
  assert.throws(() => assertMigrationEnvironment(env({ NEON_BRANCH_ID: PRODUCTION, EXPECTED_NEON_PREVIEW_BRANCH_ID: PRODUCTION })), /Production branch is refused/);
  assert.throws(() => assertMigrationEnvironment(env({ NEON_BRANCH_ID: "br-other", EXPECTED_NEON_PREVIEW_BRANCH_ID: "br-other", EXPECTED_NEON_PRODUCTION_BRANCH_ID: "br-other" })), /Production branch is refused/);
});
test("the branch must exactly match the expected branch for the target, and every variable is required", () => {
  assert.throws(() => assertMigrationEnvironment(env({ EXPECTED_NEON_PREVIEW_BRANCH_ID: "br-something-else" })), /does not match the expected Neon branch/);
  assert.throws(() => assertMigrationEnvironment(env({ EXPECTED_NEON_PREVIEW_BRANCH_ID: undefined })), /does not match the expected Neon branch/);
  for (const key of ["DATABASE_URL_UNPOOLED", "MIGRATION_TARGET_ENV", "NEON_BRANCH_ID"]) assert.throws(() => assertMigrationEnvironment(env({ [key]: undefined })), /required/, key);
  assert.throws(() => assertMigrationEnvironment(env({ MIGRATION_TARGET_ENV: "staging" })), /Invalid MIGRATION_TARGET_ENV/);
});

// ---- timeouts, on the connection migrate() actually uses ---------------------------------------------
test("the pool is single-connection with a 15s connect timeout and no connection-string startup options", () => {
  const { done } = run();
  return done.then(() => {
    const [pool] = FakePool.instances;
    assert.equal(pool!.options.max, 1);
    assert.equal(pool!.options.connectionTimeoutMillis, 15_000);
    assert.equal(CONNECTION_TIMEOUT_MS, 15_000);
    assert.equal("options" in pool!.options, false, "startup `options` are rejected by the Neon pooler and are not relied on");
    assert.equal(typeof pool!.options.verify, "function");
  });
});
test("the lock, statement and idle-in-transaction timeouts are installed on the connection before it is used", async () => {
  assert.match(SESSION_SETTINGS_SQL, /SET lock_timeout = '10s'/);
  assert.match(SESSION_SETTINGS_SQL, /SET statement_timeout = '120s'/);
  assert.match(SESSION_SETTINGS_SQL, /SET idle_in_transaction_session_timeout = '60s'/);
  const { done } = run();
  await done;
  const [pool] = FakePool.instances;
  assert.deepEqual(pool!.clientQueries, [SESSION_SETTINGS_SQL], "the SETs went to the very client that then served the queries");
  assert.deepEqual(pool!.queries, ["show lock_timeout"], "and they were confirmed with SHOW before migrate() ran");
});
test("the settings are installed by pg-pool's verify hook, which runs for every NEW physical client (also after a reconnect) and rejects the acquisition on failure", async () => {
  const pool = createMigrationPool({ url: direct, Pool: FakePool as never }) as unknown as FakePool;
  const sql: string[] = [];
  await new Promise<void>((resolve, reject) => (pool.options.verify as VerifyHook)({ query: async (s: string) => { sql.push(s); } }, (e?: Error) => (e ? reject(e) : resolve())));
  assert.deepEqual(sql, [SESSION_SETTINGS_SQL]);
  await assert.rejects(new Promise<void>((resolve, reject) => (pool.options.verify as VerifyHook)({ query: async () => { throw new Error("SET refused"); } }, (e?: Error) => (e ? reject(e) : resolve()))), /SET refused/);
  const poolPackage = readFileSync(createRequire(createRequire(import.meta.url).resolve("pg")).resolve("pg-pool"), "utf8");
  assert.match(poolPackage, /isNew && this\.options\.verify/, "the installed pg-pool must keep honouring the verify option");
  assert.match(poolPackage, /this\.options\.verify\(client,[\s\S]*?pendingItem\.callback\(undefined, client, client\.release\)/, "a client is handed out only after verify succeeded");
});
test("if the timeouts did not take effect, migrate() is never called", async () => {
  let called = false;
  const { done } = run({ Pool: class extends FakePool { constructor(o: Record<string, unknown>) { super({ ...o, verify: (_c: unknown, d: () => void) => d() }); } } as never, migrate: (async () => { called = true; }) as never });
  await assert.rejects(done, /Session timeouts were not applied/);
  assert.equal(called, false);
});
test("migrate() receives the guarded pool and the migrations folder", async () => {
  let seen: { pool: unknown; folder: unknown } | undefined;
  const { done, logs } = run({ migrate: (async (db: { pool: unknown }, cfg: { migrationsFolder: unknown }) => { seen = { pool: db.pool, folder: cfg.migrationsFolder }; }) as never });
  await done;
  assert.equal(seen?.pool, FakePool.instances[0]);
  assert.equal(seen?.folder, "drizzle-pg");
  assert.ok(logs.some((l) => l.startsWith("Migration completed for preview")));
});

// ---- failure, secrets, bounded cleanup ---------------------------------------------------------------
test("a failing migration propagates as a failure (not swallowed) and still cleans up", async () => {
  const boom = Object.assign(new Error("relation does not exist"), { severity: "ERROR", code: "42P01" });
  const { done, logs } = run({ migrate: (async () => { throw boom; }) as never });
  await assert.rejects(done, (e) => e === boom);
  assert.equal(FakePool.instances[0]!.ended, true, "pool.end() was called");
  assert.ok(logs.some((l) => l.includes("failed (42P01: relation does not exist)")));
});
test("no output of any phase - success or failure - contains the URL, host, user or password", async () => {
  const leaky = Object.assign(new Error(`getaddrinfo ENOTFOUND ${SECRET_HOST} for ${direct}`), { code: "ENOTFOUND", hostname: SECRET_HOST });
  for (const migrate of [async () => {}, async () => { throw leaky; }]) {
    const { done, logs } = run({ migrate: migrate as never });
    await done.catch((e: Error) => { noSecrets(safeErrorSummary(e), "summary"); });
    noSecrets(logs.join("\n"), "logs");
    assert.ok(logs.every((l) => l.startsWith("[migrate] ") || l.startsWith("Migration completed")), "only fixed phase names are logged");
  }
  assert.equal(safeErrorSummary(leaky), "ENOTFOUND", "a non-server error is reduced to its code");
});
test("cleanup is bounded: a pool whose end() never settles cannot hold the process, on success or failure", async () => {
  const stuck = class extends FakePool { constructor(o: Record<string, unknown>) { super(o); this.endImpl = () => new Promise<void>(() => {}); } };
  const t0 = Date.now();
  await run({ Pool: stuck as never, cleanupTimeoutMs: 50 }).done;
  await assert.rejects(run({ Pool: stuck as never, cleanupTimeoutMs: 50, migrate: (async () => { throw new Error("nope"); }) as never }).done, /nope/);
  assert.ok(Date.now() - t0 < 2_000, "returned promptly instead of waiting on pool.end()");
  await closePoolBounded({ end: () => new Promise(() => {}) }, 30);
  assert.equal(CLEANUP_TIMEOUT_MS, 5_000);
});
test("an overall time limit turns a migrate() that never returns into a failure", async () => {
  const { done } = run({ migrate: (() => new Promise(() => {})) as never, overallTimeoutMs: 40, cleanupTimeoutMs: 30 });
  await assert.rejects(done, (e: Error) => e instanceof MigrationGuardError && e.message === "overall timeout");
});
test("the runner exits explicitly after cleanup, and keeps the documented npm script", () => {
  const runner = readFileSync("scripts/migrate.mjs", "utf8");
  assert.match(runner, /runMigration\(\{ Pool: pg\.Pool, drizzle, migrate \}\)/);
  assert.match(runner, /process\.exit\(0\)/);
  assert.match(runner, /process\.exit\(1\)/);
  assert.doesNotMatch(runner, /connectionString|DATABASE_URL|console\.log\(.*env/i, "the runner itself never touches the URL");
  assert.match(readFileSync("package.json", "utf8"), /"db:migrate": "node scripts\/migrate\.mjs"/);
});
test("the real pg.Pool accepts the guarded options without connecting", async () => {
  const pool = createMigrationPool({ url: direct, Pool: pg.Pool });
  assert.equal((pool as unknown as { options: { connectionTimeoutMillis: number } }).options.connectionTimeoutMillis, 15_000);
  assert.equal(typeof (pool as unknown as { options: { verify: unknown } }).options.verify, "function");
  await pool.end();
});
