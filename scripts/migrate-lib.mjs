/**
 * Fail-fast migration runner (Phase 3.4A.2). Split from scripts/migrate.mjs so every guard is unit-testable
 * with injected dependencies (no database, no network).
 *
 * Why it exists: the original runner built a pool with NO timeouts, so any stall - a silent proxy, a cold
 * endpoint, or an ACCESS EXCLUSIVE lock wait behind another session - became an infinite hang, and
 * `pool.end()` in `finally` could not rescue it. Every wait is now bounded, and nothing here ever prints a
 * URL, host, user, password or any environment value: only fixed phase names and Postgres error codes.
 */
export const CONNECTION_TIMEOUT_MS = 15_000;
export const OVERALL_TIMEOUT_MS = 300_000;
export const CLEANUP_TIMEOUT_MS = 5_000;
// Applied to EVERY physical connection, before anything else uses it (see createMigrationPool).
export const SESSION_SETTINGS_SQL = "SET lock_timeout = '10s'; SET statement_timeout = '120s'; SET idle_in_transaction_session_timeout = '60s'";
// What `SHOW` reports for those values (Postgres normalises 120s -> 2min, 60s -> 1min).
export const EXPECTED_SETTINGS = { lock_timeout: "10s", statement_timeout: "2min", idle_in_transaction_session_timeout: "1min" };
// Defence in depth: a known Production branch is refused for any non-production target, even if the operator's
// "expected" variable was (mis)set to it.
export const KNOWN_PRODUCTION_BRANCH_IDS = ["br-nameless-grass-aw9qpndy"];

/** An error whose message is a fixed string that can never contain a value, so it is always safe to print. */
export class MigrationGuardError extends Error { constructor(message) { super(message); this.name = "MigrationGuardError"; } }

/** Validates the environment and returns the connection string. Throws fixed messages that never contain a value. */
export function assertMigrationEnvironment(env) {
  const url = env.DATABASE_URL_UNPOOLED, target = env.MIGRATION_TARGET_ENV, branch = env.NEON_BRANCH_ID;
  if (!url || !target || !branch) throw new MigrationGuardError("DATABASE_URL_UNPOOLED, MIGRATION_TARGET_ENV and NEON_BRANCH_ID are required.");
  if (!["development", "preview", "production"].includes(target)) throw new MigrationGuardError("Invalid MIGRATION_TARGET_ENV.");
  if (target === "production" && env.ALLOW_PRODUCTION_MIGRATION !== "I_UNDERSTAND_PRODUCTION") throw new MigrationGuardError("Production migration is blocked.");
  if (target !== "production" && (KNOWN_PRODUCTION_BRANCH_IDS.includes(branch) || (env.EXPECTED_NEON_PRODUCTION_BRANCH_ID && branch === env.EXPECTED_NEON_PRODUCTION_BRANCH_ID))) throw new MigrationGuardError("A Production branch is refused for a non-production migration target.");
  const expected = env[`EXPECTED_NEON_${target.toUpperCase()}_BRANCH_ID`];
  if (!expected || expected !== branch) throw new MigrationGuardError("Migration target does not match the expected Neon branch.");
  let hostname;
  try { hostname = new URL(url).hostname; } catch { throw new MigrationGuardError("DATABASE_URL_UNPOOLED is not a valid connection URL."); } // never rethrow the URL error: it echoes the input
  if (!hostname) throw new MigrationGuardError("DATABASE_URL_UNPOOLED is not a valid connection URL.");
  if (hostname.toLowerCase().includes("-pooler")) throw new MigrationGuardError("DATABASE_URL_UNPOOLED points to a pooler endpoint; migrations require the direct endpoint.");
  return { url, target, branch };
}

/**
 * One connection, bounded connect, and session timeouts installed through pg-pool's `verify` hook.
 * `verify` runs for every NEW physical client BEFORE the pool hands it to anyone - whether the Drizzle migrator
 * uses `pool.query` (the schema/ledger statements) or `pool.connect()` (its migration transaction) - and a failing
 * SET rejects the acquisition. A one-time SET on an unrelated client would not cover a reconnect.
 */
export function createMigrationPool({ url, Pool }) {
  return new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    ssl: { rejectUnauthorized: true },
    verify: (client, done) => { client.query(SESSION_SETTINGS_SQL).then(() => done(), (error) => done(error)); },
  });
}

const timer = (ms, message) => { let id; const promise = new Promise((_, reject) => { id = setTimeout(() => reject(new MigrationGuardError(message)), ms); id.unref?.(); }); return { promise, cancel: () => clearTimeout(id) }; };

/** pool.end() with a deadline: an unhealthy socket can no longer keep shutdown waiting forever. */
export async function closePoolBounded(pool, ms = CLEANUP_TIMEOUT_MS, log = () => {}) {
  const deadline = timer(ms, "cleanup timeout");
  try { await Promise.race([Promise.resolve().then(() => pool.end()), deadline.promise]); log("pool closed"); }
  catch { log("pool shutdown did not finish in time; continuing"); }
  finally { deadline.cancel(); }
}

/** A message that is safe to print: a server-side Postgres error (has a severity) keeps its text, everything else only a code/name. */
export function safeErrorSummary(error) {
  if (error instanceof MigrationGuardError) return error.message;
  const code = typeof error?.code === "string" ? error.code : error?.name ?? "Error";
  if (typeof error?.severity === "string" && typeof error?.message === "string") return `${code}: ${error.message.slice(0, 200)}`;
  return String(code);
}

/** @param {{ env?: Record<string, string | undefined>, Pool: any, drizzle: any, migrate: any, migrationsFolder?: string, log?: (message: string) => void, overallTimeoutMs?: number, cleanupTimeoutMs?: number }} options */
export async function runMigration({ env = process.env, Pool, drizzle, migrate, migrationsFolder = "drizzle-pg", log = console.log, overallTimeoutMs = OVERALL_TIMEOUT_MS, cleanupTimeoutMs = CLEANUP_TIMEOUT_MS }) {
  const phase = (name) => log(`[migrate] ${name}`);
  phase("validate-environment");
  const { target, branch } = assertMigrationEnvironment(env);
  phase("create-pool");
  const pool = createMigrationPool({ url: env.DATABASE_URL_UNPOOLED, Pool });
  pool.on?.("error", () => {}); // an idle-client error must not crash the process; the running query reports its own failure
  const overall = timer(overallTimeoutMs, "overall timeout");
  try {
    phase("connect-and-verify-session");
    const { rows } = await Promise.race([pool.query("show lock_timeout"), overall.promise]);
    const lockTimeout = rows?.[0]?.lock_timeout;
    if (lockTimeout !== EXPECTED_SETTINGS.lock_timeout) throw new MigrationGuardError("Session timeouts were not applied to the migration connection.");
    phase("migrate");
    await Promise.race([migrate(drizzle(pool), { migrationsFolder }), overall.promise]);
    phase("migrate-complete");
    log(`Migration completed for ${target} (${branch}).`);
  } catch (error) {
    phase(`failed (${safeErrorSummary(error)})`);
    throw error;
  } finally {
    overall.cancel();
    phase("cleanup");
    await closePoolBounded(pool, cleanupTimeoutMs, (message) => phase(message));
  }
}
