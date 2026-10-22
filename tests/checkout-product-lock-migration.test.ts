import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyMigrationIntegrity } from "../scripts/verify-migration-integrity.mjs";

const migration = readFileSync("drizzle-pg/0017_checkout_product_lock.sql", "utf8");
const route = readFileSync("app/api/orders/route.ts", "utf8");

test("0017 is an additive migration after the immutable legal evidence chain", () => {
  const journal = JSON.parse(readFileSync("drizzle-pg/meta/_journal.json", "utf8"));
  assert.equal(journal.entries[16].tag, "0016_legal_documents_immutability_guard");
  assert.equal(journal.entries[17].tag, "0017_checkout_product_lock");
  assert.deepEqual(verifyMigrationIntegrity(process.cwd()), []);
});

test("product lock function has fixed search path, bounded arguments and sorted shared locks", () => {
  assert.match(migration, /CREATE FUNCTION public\.lock_checkout_products\(p_product_ids text\[\]\)/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = pg_catalog, public/);
  assert.match(migration, /cardinality\(p_product_ids\) > 25/);
  assert.match(migration, /array_position\(p_product_ids, NULL\)/);
  assert.match(migration, /count\(DISTINCT item\.id\)/);
  assert.match(migration, /FROM public\.products AS p[\s\S]*ORDER BY p\.id\s+FOR SHARE/);
  assert.match(migration, /locked_count <> cardinality\(p_product_ids\)/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.lock_checkout_products\(text\[\]\) FROM PUBLIC/);
  const executableSql = migration.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");
  assert.doesNotMatch(executableSql, /\bGRANT\s+(?:ALL|EXECUTE)\b/i, "runtime EXECUTE grant must be an explicit post-migration rollout step");
  assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE|INSERT|TRUNCATE)\s+(?:INTO\s+|FROM\s+)?public\.products\b/i);
});

test("legacy product lock remains unchanged when scoped checkout is disabled", () => {
  assert.match(route, /if \(process\.env\.CHECKOUT_SCOPED_DB_ENABLED === "true"\)/);
  assert.match(route, /tx\.execute\(sql`SELECT public\.lock_checkout_products\(/);
  assert.match(route, /else \{[\s\S]*?\.orderBy\(asc\(products\.id\)\)\.for\("share"\)/);
  assert.match(route, /await tx\.execute\(sql`set local lock_timeout = '5s'`\)/);
  assert.match(route, /\{ isolationLevel: "read committed" \}/);
});
