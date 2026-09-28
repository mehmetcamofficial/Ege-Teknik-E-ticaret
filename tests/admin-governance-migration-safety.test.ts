import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "drizzle-pg/0011_admin_governance.sql";
const migration = readFileSync(migrationPath, "utf8");
const journal = JSON.parse(readFileSync("drizzle-pg/meta/_journal.json", "utf8")) as { entries: { idx: number; when: number; tag: string }[] };
const guard = migration.slice(migration.indexOf("DO $$ DECLARE"), migration.indexOf("Block 1:"));

type GuardDecision = "promote-one" | "resume" | "abort-zero" | "abort-many";
const ownerGuardDecision = (activeOwners: number, consolidationAudits: number): GuardDecision => {
  if (activeOwners === 1) return "promote-one";
  if (activeOwners === 0 && consolidationAudits >= 1) return "resume";
  if (activeOwners === 0) return "abort-zero";
  return "abort-many";
};

test("0011 remains byte-for-byte immutable after its reviewed application", () => {
  assert.equal(createHash("sha256").update(migration).digest("hex"), "f740bd31ff771742ed335aa2c2f1c3f4c44d03d30dcc9c4488c612a2c95d7626");
});

test("the 0011 owner guard covers empty, one-owner, multi-owner and resume states", () => {
  assert.equal(ownerGuardDecision(0, 0), "abort-zero", "a clean empty schema cannot invent a privileged identity");
  assert.equal(ownerGuardDecision(1, 0), "promote-one");
  assert.equal(ownerGuardDecision(2, 0), "abort-many");
  assert.equal(ownerGuardDecision(0, 1), "resume", "the deterministic audit makes a retry resume-tolerant");
  assert.match(guard, /active_owner_count = 1 THEN[\s\S]*active_owner_count = 0 AND consolidation_count >= 1 THEN[\s\S]*active_owner_count = 0 THEN[\s\S]*ELSE/);
  assert.match(migration, /ON CONFLICT \("id"\) DO NOTHING/);
});

test("an already-recorded 0011 is ordered before 0012 and is not a forward repair point", () => {
  const entry0011 = journal.entries.find((entry) => entry.tag === "0011_admin_governance")!;
  const entry0012 = journal.entries.find((entry) => entry.tag === "0012_delivery_class")!;
  assert.equal(entry0011.idx, 11);
  assert.ok(entry0012.when > entry0011.when);

  const dialectPath = join(dirname(import.meta.resolve("drizzle-orm/pg-core").replace("file://", "")), "dialect.js");
  const dialect = readFileSync(dialectPath, "utf8");
  assert.match(dialect, /order by created_at desc limit 1/);
  assert.match(dialect, /Number\(lastDbMigration\.created_at\) < migration\.folderMillis/);
  assert.doesNotMatch(dialect, /lastDbMigration\.hash\s*[!=]==?\s*migration\.hash/, "Drizzle records a hash but does not use it to replay edited historical SQL");
});

test("a forward migration cannot repair clean bootstrap because 0011 aborts first", () => {
  assert.equal(ownerGuardDecision(0, 0), "abort-zero");
  assert.ok(journal.entries.some((entry) => entry.idx > 11), "later migrations exist but are unreachable until the 0011 precondition is met");
  assert.match(guard, /refusing to invent a privileged identity/);
});
