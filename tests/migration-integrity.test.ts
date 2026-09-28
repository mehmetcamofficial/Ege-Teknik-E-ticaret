import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyMigrationIntegrity } from "../scripts/verify-migration-integrity.mjs";

const copy = () => {
  const root = mkdtempSync(join(tmpdir(), "mig-int-"));
  cpSync("drizzle-pg", join(root, "drizzle-pg"), { recursive: true });
  return root;
};

test("the repository's frozen migrations 0000-0012 are unchanged and the journal is consistent", () => {
  assert.deepEqual(verifyMigrationIntegrity(process.cwd()), []);
});

test("editing an applied migration is detected", () => {
  const root = copy();
  const file = join(root, "drizzle-pg/0011_admin_governance.sql");
  writeFileSync(file, readFileSync(file, "utf8") + "\n-- tampered\n");
  assert.ok(verifyMigrationIntegrity(root).some((p) => /0011_admin_governance\.sql was MODIFIED/.test(p)));
});

test("removing, or re-timestamping, a frozen journal entry is detected", () => {
  const root = copy();
  const journalPath = join(root, "drizzle-pg/meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  journal.entries[5].when += 1;
  writeFileSync(journalPath, JSON.stringify(journal));
  assert.ok(verifyMigrationIntegrity(root).some((p) => /journal entry 5 no longer matches/.test(p)));
});

test("a NEW migration after the current head is allowed only when contiguous and journaled", () => {
  const root = copy();
  const journalPath = join(root, "drizzle-pg/meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  const count = journal.entries.length; // 13 before the finance ledger (0013), 14 with it: the test follows the real head
  const tag = `${String(count).padStart(4, "0")}_new_thing`;
  writeFileSync(join(root, `drizzle-pg/${tag}.sql`), "SELECT 1;\n");
  assert.ok(verifyMigrationIntegrity(root).some((p) => new RegExp(`journal lists ${count} migrations but ${count + 1} SQL files exist`).test(p)), "an un-journaled file is flagged");
  const last = journal.entries[count - 1];
  journal.entries.push({ idx: count, version: "7", when: last.when + 1000, tag, breakpoints: true });
  writeFileSync(journalPath, JSON.stringify(journal));
  assert.deepEqual(verifyMigrationIntegrity(root), []);
  journal.entries[count].when = last.when;
  writeFileSync(journalPath, JSON.stringify(journal));
  assert.ok(verifyMigrationIntegrity(root).some((p) => /does not increase/.test(p)));
});

test("migration 0013 (finance ledger) is a permitted, additive addition that leaves the frozen 0000-0012 untouched", () => {
  const sql = readFileSync("drizzle-pg/0013_finance_ledger.sql", "utf8");
  assert.doesNotMatch(sql, /\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bUPDATE\s+"|\bALTER\s+COLUMN\b|\bRENAME\b/i, "additive only");
  assert.equal(sql.match(/ADD COLUMN/g)?.length, 8);
  assert.equal(sql.match(/FOREIGN KEY/g)?.length, 2);
  assert.equal(sql.match(/CREATE (UNIQUE )?INDEX/g)?.length, 3);
  assert.equal(sql.match(/CHECK \([^;]*\) NOT VALID/g)?.length, 7);
  assert.doesNotMatch(sql, /orders_created_idx/, "the index that was deliberately dropped from the design must not return");
  assert.deepEqual(verifyMigrationIntegrity(process.cwd()), []);
});

test("the gate never touches a database", () => {
  const src = readFileSync("scripts/verify-migration-integrity.mjs", "utf8");
  assert.doesNotMatch(src, /from "pg"|node-postgres|DATABASE_URL|connect\(/);
});
