import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { destructiveReasons } from "./support/migration-sql.ts";

const file = "drizzle-pg/0007_product_enrichment.sql";
const migration = readFileSync(file, "utf8");
const statements = migration.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);

test("the destructive-SQL detector actually catches destructive statements", () => {
  for (const bad of ['DROP TABLE "products";', 'ALTER TABLE "products" DROP COLUMN "price";', "TRUNCATE products;", "DELETE FROM products;", "UPDATE products SET price = 1;", "INSERT INTO products VALUES (1);", 'ALTER TABLE "products" RENAME COLUMN "a" TO "b";', 'ALTER TABLE "products" ALTER COLUMN "price" SET DATA TYPE text;']) assert.ok(destructiveReasons(bad).length > 0, bad);
  assert.deepEqual(destructiveReasons('ALTER TABLE "products" ADD COLUMN "x" text;'), []);
});
test("migration 0007 follows 0006 in the journal and is additive only", () => {
  const tags = (JSON.parse(readFileSync("drizzle-pg/meta/_journal.json", "utf8")).entries as { tag: string }[]).map((e) => e.tag);
  assert.equal(tags[tags.indexOf("0006_checkout_charges_and_marketing_consents") + 1], "0007_product_enrichment");
  assert.ok(readdirSync("drizzle-pg").includes("0007_product_enrichment.sql"));
  assert.deepEqual(destructiveReasons(migration), []);
});
test("every statement adds a column to products that is nullable or has a default (existing rows stay valid, no backfill)", () => {
  assert.equal(statements.length, 6);
  for (const s of statements) {
    assert.match(s, /^ALTER TABLE "products" ADD COLUMN "[a-z_]+" (text|jsonb)/, s);
    assert.ok(!/NOT NULL/.test(s) || /DEFAULT/.test(s), `NOT NULL requires a default: ${s}`);
  }
  assert.deepEqual(statements.map((s) => s.match(/ADD COLUMN "([a-z_]+)"/)![1]).sort(), ["documents", "gallery", "manufacturer_warranty", "short_description", "source_url", "specifications"]);
  assert.doesNotMatch(migration, /price|vat_rate_bps|sale_mode|status|inventory|orders|customers|legal/i);
});
test("the schema mirrors the migration and keeps the commercial columns untouched", () => {
  const schema = readFileSync("db/schema.ts", "utf8");
  for (const col of ["short_description", "gallery", "specifications", "documents", "manufacturer_warranty", "source_url"]) assert.match(schema, new RegExp(`"${col}"`));
  assert.match(schema, /price:integer\("price"\)\.notNull\(\)\.default\(0\)/);
  assert.match(schema, /saleMode:text\("sale_mode"\)\.notNull\(\)\.default\("quote"\)/);
});
