#!/usr/bin/env node
// CI-only real PostgreSQL upgrade gate: 0018 -> 0026 via the actual Drizzle migrator.
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
assert.equal(journal.entries.length, 27);
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
  assert.equal(after, 27, "upgrade must record 27 migrations");
  const schema = (await pool.query(`SELECT to_regprocedure('public.checkout_replay_by_key(text,text)') IS NOT NULL AS replay,
    to_regprocedure('public.legal_acceptance_no_mutation()') IS NOT NULL AS immutable,
    to_regclass('public.notification_outbox') IS NOT NULL AS outbox,
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notification_outbox' AND column_name='claim_token') AS claim_token,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname='notification_outbox_claim_token_ck') AS claim_token_check,
    to_regclass('public.notification_send_budget') IS NOT NULL AS send_budget,
    to_regclass('public.notification_send_reservation') IS NOT NULL AS send_reservation,
    to_regprocedure('public.reserve_notification_send(text,text[],text[],integer[],timestamptz)') IS NOT NULL AS reserve_fn,
    (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='used_products'
      AND column_name IN ('inspection_date','inspection_result','cooling_test','heating_test','condition_grade','known_defects','missing_accessories','warranty_months')) AS inspection_columns`)).rows[0];
  assert.deepEqual(schema, { replay: true, immutable: true, outbox: true, claim_token: true, claim_token_check: true, send_budget: true, send_reservation: true, reserve_fn: true, inspection_columns: 8 });
  for (const table of ["merchant_bank_accounts", "bank_movements", "eft_reconciliation_reviews"]) {
    assert.notEqual((await pool.query("SELECT to_regclass($1) AS t", ["public." + table])).rows[0].t, null, table + " must exist");
  }
  const eftConstraints = (await pool.query(`SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE conname IN ('eft_reviews_distinct_actors_ck','eft_reviews_approved_ck')`)).rows;
  assert.equal(eftConstraints.length, 2, "EFT approval CHECK constraints must exist");
  const distinct = eftConstraints.find((c) => c.conname === "eft_reviews_distinct_actors_ck")?.definition ?? "";
  for (const pair of ["approved_by <> created_by", "approved_by <> reviewed_by", "reviewed_by <> created_by"])
    assert.ok(distinct.includes(pair), "three-person control missing: " + pair);
  const unique = (await pool.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public'
    AND indexname IN ('bank_movements_external_uq','bank_movements_fingerprint_uq','eft_reviews_movement_approved_uq')`)).rows;
  assert.equal(unique.length, 3, "bank movement dedupe and approval uniqueness indexes must exist");
  // Exercise the real PostgreSQL uniqueness constraints without retaining fixture rows.
  const fixtureClient = await pool.connect();
  await fixtureClient.query("BEGIN");
  try {
    const account = "eft-ci-account";
    await fixtureClient.query(`INSERT INTO merchant_bank_accounts (id,bank_label,account_alias,iban_last4)
      VALUES ($1,'CI bank','CI account','1234')`, [account]);
    const movement = `INSERT INTO bank_movements
      (id,bank_account_id,source,external_transaction_id,import_fingerprint,amount,booked_at)
      VALUES ($1,$2,'ci-import',$3,$4,100,now())`;
    await fixtureClient.query(movement, ["eft-ci-m1", account, "tx-1", "a".repeat(64)]);
    await fixtureClient.query("SAVEPOINT eft_dedupe_external");
    await assert.rejects(fixtureClient.query(movement, ["eft-ci-m2", account, "tx-1", "b".repeat(64)]), (error) => error.code === "23505");
    await fixtureClient.query("ROLLBACK TO SAVEPOINT eft_dedupe_external");
    await fixtureClient.query("SAVEPOINT eft_dedupe_fingerprint");
    await assert.rejects(fixtureClient.query(movement, ["eft-ci-m3", account, "tx-2", "a".repeat(64)]), (error) => error.code === "23505");
    await fixtureClient.query("ROLLBACK TO SAVEPOINT eft_dedupe_fingerprint");
    // A malformed fingerprint or zero-value movement must never enter reconciliation.
    await fixtureClient.query("SAVEPOINT eft_invalid_fingerprint");
    await assert.rejects(fixtureClient.query(movement, ["eft-ci-m4", account, "tx-4", "not-a-sha256"]), (error) => error.code === "23514");
    await fixtureClient.query("ROLLBACK TO SAVEPOINT eft_invalid_fingerprint");
    await fixtureClient.query("SAVEPOINT eft_zero_amount");
    await assert.rejects(fixtureClient.query(`INSERT INTO bank_movements
      (id,bank_account_id,source,external_transaction_id,import_fingerprint,amount,booked_at)
      VALUES ($1,$2,'ci-import','tx-zero',$3,0,now())`,
      ["eft-ci-zero", account, "c".repeat(64)]), (error) => error.code === "23514");
    await fixtureClient.query("ROLLBACK TO SAVEPOINT eft_zero_amount");
    // DB-level three-person separation must reject a creator who also reviewed.
    for (const id of ["eft-ci-creator", "eft-ci-reviewer", "eft-ci-approver"]) {
      await fixtureClient.query(`INSERT INTO admin_users (id,external_user_id,email,role)
        VALUES ($1,$2,$3,'finance_manager')`, [id, "external-" + id, id + "@example.test"]);
    }
    await fixtureClient.query(`INSERT INTO eft_reconciliation_reviews
      (id,movement_id,status,created_by,reviewed_by)
      VALUES ('eft-ci-review','eft-ci-m1','proposed','eft-ci-creator','eft-ci-creator')`);
    await fixtureClient.query("SAVEPOINT eft_distinct_actors");
    await assert.rejects(fixtureClient.query(`UPDATE eft_reconciliation_reviews
      SET approved_by='eft-ci-approver' WHERE id='eft-ci-review'`), (error) => error.code === "23514");
    await fixtureClient.query("ROLLBACK TO SAVEPOINT eft_distinct_actors");
  } finally {
    await fixtureClient.query("ROLLBACK");
    fixtureClient.release();
  }
  await migrate(drizzle(pool), { migrationsFolder: "drizzle-pg" });
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n, 27, "rerun must be idempotent");
  console.log("[migration-upgrade] PASS: real Drizzle 0018->0026, 19->27 ledger, schema, idempotency");
} finally {
  await pool.end().catch(() => {});
  rmSync(folder, { recursive: true, force: true });
}
