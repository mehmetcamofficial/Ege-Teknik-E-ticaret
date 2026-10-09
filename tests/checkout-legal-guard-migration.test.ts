import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyMigrationIntegrity } from "../scripts/verify-migration-integrity.mjs";

const migration = readFileSync("drizzle-pg/0018_checkout_legal_guard_definer.sql", "utf8");

test("0018 follows 0017 without altering the frozen migration chain", () => {
  const journal = JSON.parse(readFileSync("drizzle-pg/meta/_journal.json", "utf8"));
  assert.equal(journal.entries.length, 19);
  assert.equal(journal.entries[17].tag, "0017_checkout_product_lock");
  assert.equal(journal.entries[18].tag, "0018_checkout_legal_guard_definer");
  assert.deepEqual(verifyMigrationIntegrity(process.cwd()), []);
});

test("0018 hardens the existing legal evidence trigger without storefront order UPDATE grants", () => {
  assert.match(migration, /ALTER FUNCTION public\.order_legal_evidence_guard\(\) SECURITY DEFINER/);
  assert.match(migration, /SET search_path = pg_catalog, public, pg_temp/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.order_legal_evidence_guard\(\) FROM PUBLIC/);
  const sql = migration.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");
  assert.doesNotMatch(sql, /\bGRANT\b/i);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO\s+|FROM\s+)?(?:public\.)?orders\b/i);
  assert.doesNotMatch(sql, /\bCREATE OR REPLACE FUNCTION\b/i, "preserve 0015 trigger body");
});
