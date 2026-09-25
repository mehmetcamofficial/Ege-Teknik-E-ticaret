import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { destructiveReasons } from "./support/migration-sql.ts";

const file = "drizzle-pg/0008_product_reviews.sql";
const migration = readFileSync(file, "utf8");
const statements = migration.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
// The guard trigger legitimately names INSERT/UPDATE as trigger events and inside its PL/pgSQL body; everything else must be DDL-only.
const functionBody = migration.slice(migration.indexOf("AS $$") + 5, migration.lastIndexOf("$$;"));
const outsideFunction = migration.replace(functionBody, "").replace(/BEFORE INSERT OR UPDATE ON "product_reviews"/, "");

test("migration 0008 is the next journal entry after 0007 and ships its snapshot", () => {
  const tags = (JSON.parse(readFileSync("drizzle-pg/meta/_journal.json", "utf8")).entries as { tag: string; idx: number }[]);
  assert.deepEqual(tags.slice(-2).map((e) => e.tag), ["0007_product_enrichment", "0008_product_reviews"]);
  assert.equal(tags.at(-1)!.idx, 8);
  assert.ok(readdirSync("drizzle-pg").includes("0008_product_reviews.sql"));
  assert.ok(readdirSync("drizzle-pg/meta").includes("0008_snapshot.json"));
});
test("0008 is additive only: no DROP/TRUNCATE/DELETE/UPDATE/INSERT/RENAME/ALTER COLUMN outside the guard trigger", () => {
  assert.deepEqual(destructiveReasons(outsideFunction), []);
  for (const s of statements) assert.match(s, /^(CREATE TABLE "product_reviews"|ALTER TABLE "product_reviews" ADD CONSTRAINT|CREATE (UNIQUE )?INDEX "product_reviews_|CREATE FUNCTION "product_reviews_guard"|CREATE TRIGGER "product_reviews_guard_trg")/, s.slice(0, 80));
  assert.doesNotMatch(migration, /ALTER TABLE "(?!product_reviews")/, "no existing table is altered");
});
test("the guard function performs no data modification: only a read-only EXISTS check and exceptions", () => {
  assert.doesNotMatch(functionBody, /\b(INSERT\s+INTO|UPDATE\s+"?\w+"?\s+SET|DELETE\s+FROM|TRUNCATE|DROP)\b/i);
  assert.match(functionBody, /NOT EXISTS \(\s*SELECT 1 FROM "order_items"/);
});
test("no seed data and no backfill: the migration never writes review rows", () => {
  assert.doesNotMatch(migration, /INSERT INTO "product_reviews"|VALUES \(/i);
});
