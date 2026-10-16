import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const migration = readFileSync("drizzle-pg/0020_legacy_legal_acceptance_immutability.sql", "utf8");

test("0020 adds only a universal mutation boundary; historical INSERT guards remain attached", () => {
  const statements = migration.split("\n").filter((line) => !line.startsWith("--")).join("\n");
  assert.match(statements, /BEFORE UPDATE OR DELETE ON public\.order_legal_acceptances/);
  assert.match(statements, /ERRCODE = '23001'/);
  assert.match(statements, /SECURITY INVOKER/);
  assert.match(statements, /REVOKE ALL ON FUNCTION public\.legal_acceptance_no_mutation\(\) FROM PUBLIC/);
  assert.doesNotMatch(statements, /\b(?:ALTER|DROP|INSERT|GRANT|TRUNCATE|REPLACE)\b/);
  assert.doesNotMatch(statements, /\b(?:OLD|NEW|slug|SELECT)\b/);
  const journal = JSON.parse(readFileSync("drizzle-pg/meta/_journal.json", "utf8"));
  assert.equal(journal.entries[20].tag, "0020_legacy_legal_acceptance_immutability");
});

for (const target of [undefined, "postgresql://fixture@db.example.test/sprintb_ci", "postgresql://fixture@127.0.0.1/real_database"]) {
  test(`legal runner refuses ${target === undefined ? "missing" : target.includes("example.test") ? "remote" : "non-disposable"} target before database access`, () => {
    const env = { ...process.env }; delete env.P3B_PG_URL;
    if (target) env.P3B_PG_URL = target;
    const result = spawnSync(process.execPath, ["scripts/test-legal-postgres.mjs"], { env, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /\[legal-postgres\] FAIL/);
    assert.doesNotMatch(result.stdout + result.stderr, /postgresql:\/\/|db\.example\.test/);
  });
}
