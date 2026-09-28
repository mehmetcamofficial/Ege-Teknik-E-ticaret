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

test("a NEW migration after 0012 is allowed only when contiguous and journaled", () => {
  const root = copy();
  writeFileSync(join(root, "drizzle-pg/0013_new_thing.sql"), "SELECT 1;\n");
  assert.ok(verifyMigrationIntegrity(root).some((p) => /journal lists 13 migrations but 14 SQL files exist/.test(p)), "an un-journaled file is flagged");
  const journalPath = join(root, "drizzle-pg/meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  journal.entries.push({ idx: 13, version: "7", when: journal.entries[12].when + 1000, tag: "0013_new_thing", breakpoints: true });
  writeFileSync(journalPath, JSON.stringify(journal));
  assert.deepEqual(verifyMigrationIntegrity(root), []);
  journal.entries[13].when = journal.entries[12].when;
  writeFileSync(journalPath, JSON.stringify(journal));
  assert.ok(verifyMigrationIntegrity(root).some((p) => /does not increase/.test(p)));
});

test("the gate never touches a database", () => {
  const src = readFileSync("scripts/verify-migration-integrity.mjs", "utf8");
  assert.doesNotMatch(src, /from "pg"|node-postgres|DATABASE_URL|connect\(/);
});
