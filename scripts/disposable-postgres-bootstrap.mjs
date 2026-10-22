/**
 * TEST-ONLY disposable-PostgreSQL bootstrap. Extracted from the setup() that
 * tests/sprint-b-postgres.integration.test.ts already runs successfully in CI, so the commerce gate
 * (scripts/test-commerce-postgres.mjs) can prepare a throwaway database the same reviewed way.
 *
 * WHY A BOOTSTRAP IS NEEDED AT ALL: migration 0011_admin_governance.sql consolidates the legacy owner
 * and its Block 0 guard is deliberately fail-closed - it aborts unless it finds exactly one active
 * owner, because it will not invent a privileged identity. Migrating an EMPTY database to head
 * therefore cannot work, and must not: that guard is the protection. What a disposable test database
 * needs is not a weaker migration but the historical state migration 0011 actually ran against:
 *
 *   0000-0010  -> the one legacy owner existed
 *   0011       -> found exactly one active owner, promoted it to super_admin, audited it
 *   0012-0014  -> applied on top
 *
 * That is exactly the sequence below, and it models the history rather than bypassing it: 0011 still
 * finds one active owner, still runs its own promotion and still writes its own audit row. Nothing
 * here disables, edits or reorders any migration, and nothing seeds a privileged identity outside a
 * disposable test database - the fixture is a throwaway row in a `sprintb*` loopback database that
 * this path drops and recreates.
 *
 * Split from the runner (like scripts/migrate-lib.mjs) so every step is unit-testable with injected
 * dependencies: no database, no network, and no environment of its own.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The reviewed pre-0011 state is created by migrating 0000-0010 first, not by relaxing any guard. */
export const OWNER_CONSOLIDATION_TAG = "0011_admin_governance";

/** Identical to the statement tests/sprint-b-postgres.integration.test.ts already applies. */
export const RESET_SQL = "drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;";

/** The one legacy owner production had when 0011 ran. Deterministic, test-only, never a real identity. */
export const LEGACY_OWNER_SQL =
  "insert into admin_users (id, external_user_id, email, role, active) values ('owner-1', 'password:o@example.test', 'o@example.test', 'owner', true)";

/** An error whose message is a fixed string that can never contain a value, so it is always safe to print. */
export class BootstrapError extends Error {
  constructor(message) {
    super(message);
    this.name = "BootstrapError";
  }
}

/**
 * The journal entries that must be applied BEFORE 0011, derived from the committed journal rather
 * than hardcoded, so the staged history stays correct if the folder layout ever changes. Throws when
 * 0011 is absent: without it there is no reviewed owner state to reproduce.
 */
export function preOwnerConsolidationEntries(journal) {
  const entries = Array.isArray(journal?.entries) ? journal.entries : null;
  if (!entries) throw new BootstrapError("the migration journal could not be read.");
  const index = entries.findIndex((entry) => String(entry?.tag).startsWith(OWNER_CONSOLIDATION_TAG));
  if (index < 1) throw new BootstrapError(`the migration journal has no ${OWNER_CONSOLIDATION_TAG} entry to reproduce.`);
  return entries.slice(0, index);
}

/**
 * Writes a temporary migrations folder holding only those entries, so the real migrator can be asked
 * for the pre-0011 state without touching drizzle-pg/ itself.
 */
export function stagePreOwnerConsolidationMigrations({ journal, migrationsFolder, entries, fs, paths }) {
  const folder = fs.mkdtempSync(paths.join(paths.tmpdir(), "commerce-mig-"));
  fs.mkdirSync(join(folder, "meta"));
  fs.writeFileSync(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
  for (const entry of entries) fs.cpSync(paths.join(migrationsFolder, `${entry.tag}.sql`), paths.join(folder, `${entry.tag}.sql`));
  return folder;
}

/**
 * Reset -> migrate to pre-0011 -> the one legacy owner -> migrate to head. @returns the staged tags,
 * so a caller can log exactly which history it reproduced.
 */
export async function bootstrapDisposableDatabase({
  Pool, drizzle, migrate, url, journal, migrationsFolder = "drizzle-pg", fs, paths, log = () => {}, connectionTimeoutMillis = 15_000,
}) {
  const phase = (name) => log(`[commerce-postgres] ${name}`);
  const entries = preOwnerConsolidationEntries(journal);
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis });
  pool.on?.("error", () => {}); // an idle-client error must not crash the gate; the query below reports its own failure
  let folder = null;
  try {
    phase("reset-schema");
    await pool.query(RESET_SQL);
    folder = stagePreOwnerConsolidationMigrations({ journal, migrationsFolder, entries, fs, paths });
    phase(`migrate-to-pre-0011 (${entries.length} migrations)`);
    await migrate(drizzle(pool), { migrationsFolder: folder });
    phase("seed-legacy-owner-for-0011");
    await pool.query(LEGACY_OWNER_SQL);
    phase("migrate-to-head");
    await migrate(drizzle(pool), { migrationsFolder });
    phase("bootstrap-complete");
    return { staged: entries.map((entry) => entry.tag) };
  } finally {
    if (folder) fs.rmSync(folder, { recursive: true, force: true });
    await pool.end().catch(() => {});
  }
}

/** The real node:fs / node:os / node:path implementations, injected by the runner. */
export const defaultStageDeps = { fs: { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync }, paths: { join, tmpdir } };
