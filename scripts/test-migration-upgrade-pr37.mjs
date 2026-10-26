#!/usr/bin/env node
// CI-only real PostgreSQL upgrade gate: 0018 -> 0023 via the actual Drizzle migrator.
// Never accepts remote hosts; resets ONLY a disposable sprintb* loopback database.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { LEGACY_OWNER_SQL, RESET_SQL } from "./disposable-postgres-bootstrap.mjs";

const raw = process.env.MIGRATION_UPGRADE_PG_URL;
let target;
try { target = new URL(raw); } catch { /* fail closed */ }
if (process.env.CI !== "true" || !target || !["127.0.0.1", "localhost", "::1"].includes(target.hostname)
  || !target.pathname.slice(1).startsWith("sprintb") || !["postgres:", "postgresql:"].includes(target.protocol)) {
  console.error("[migration-upgrade] REFUSED: requires CI and disposable sprintb loopback PostgreSQL");
  process.exit(1);
}
const journal = JSON.parse(readFileSync("drizzle-pg/meta/_journal.json", "utf8"));
assert.equal(journal.entries.length, 24);
const folder = mkdtempSync(join(tmpdir(), "pr37-migration-upgrade-"));
const pool = new pg.Pool({ connectionString: raw, max: 1, connectionTimeoutMillis: 15000 });
const stage = (lastIdx) => {
  const dir = join(folder, String(lastIdx));
  mkdirSync(join(dir, "meta"), { recursive: true });
  writeFileSync(join(dir, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, lastIdx + 1) }));
  for (const entry of journal.entries.slice(0, lastIdx + 1)) cpSync(join("drizzle-pg", entry.tag + ".sql"), join(dir, entry.tag + ".sql"));
  return dir;
};
try {
  await pool.query(RESET_SQL);
  await migrate(drizzle(pool), { migrationsFolder: stage(10) });
  await pool.query(LEGACY_OWNER_SQL);
  await migrate(drizzle(pool), { migrationsFolder: stage(18) });
  const before = (await pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n;
  assert.equal(before, 19, "pre-upgrade ledger must contain 19 entries");
  assert.equal((await pool.query("SELECT to_regclass('public.notification_outbox') AS t")).rows[0].t, null);
  await migrate(drizzle(pool), { migrationsFolder: "drizzle-pg" });
  const after = (await pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n;
  assert.equal(after, 24, "upgrade must record 24 migrations");
  const schema = (await pool.query(`SELECT to_regprocedure('public.checkout_replay_by_key(text,text)') IS NOT NULL AS replay,
    to_regprocedure('public.legal_acceptance_no_mutation()') IS NOT NULL AS immutable,
    to_regclass('public.notification_outbox') IS NOT NULL AS outbox,
    (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='used_products'
      AND column_name IN ('inspection_date','inspection_result','cooling_test','heating_test','condition_grade','known_defects','missing_accessories','warranty_months')) AS inspection_columns`)).rows[0];
  assert.deepEqual(schema, { replay: true, immutable: true, outbox: true, inspection_columns: 8 });
  await migrate(drizzle(pool), { migrationsFolder: "drizzle-pg" });
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n, 24, "rerun must be idempotent");
  console.log("[migration-upgrade] PASS: real Drizzle 0018->0023, 19->24 ledger, schema, idempotency");
} finally {
  await pool.end().catch(() => {});
  rmSync(folder, { recursive: true, force: true });
}
