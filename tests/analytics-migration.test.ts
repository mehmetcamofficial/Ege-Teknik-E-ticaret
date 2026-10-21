import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { destructiveReasons } from "./support/migration-sql.ts";

const file = "drizzle-pg/0009_analytics_events.sql";
const migration = readFileSync(file, "utf8");
const statements = migration.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);

test("migration 0009 is the next journal entry after 0008 and ships its snapshot", () => {
  const entries = (JSON.parse(readFileSync("drizzle-pg/meta/_journal.json", "utf8")).entries as { tag: string; idx: number }[]);
  const at = (tag: string) => entries.find((e) => e.tag === tag);
  assert.equal(at("0009_analytics_events")?.idx, at("0008_product_reviews")!.idx + 1);
  assert.equal(at("0009_analytics_events")?.idx, 9);
  assert.ok(readdirSync("drizzle-pg").includes("0009_analytics_events.sql"));
  assert.ok(readdirSync("drizzle-pg/meta").includes("0009_snapshot.json"));
});
test("0009 is additive only: one new table, no DROP/TRUNCATE/DELETE/UPDATE/INSERT/RENAME/ALTER COLUMN, and no existing table is touched", () => {
  assert.deepEqual(destructiveReasons(migration), []);
  for (const s of statements) assert.match(s, /^(CREATE TABLE "analytics_events"|ALTER TABLE "analytics_events" ADD CONSTRAINT|CREATE INDEX "analytics_events_)/, s.slice(0, 80));
  assert.doesNotMatch(migration, /ALTER TABLE "(?!analytics_events")/, "no existing table is altered");
});
test("no seed data: the migration never writes an analytics_events row (and could not fabricate visitor history if it tried)", () => {
  assert.doesNotMatch(migration, /INSERT INTO "analytics_events"|VALUES \(/i);
});
test("the table has no raw-IP or raw-user-agent column - only a classified device category and a hashed-nowhere anonymous visitor id", () => {
  assert.doesNotMatch(migration, /"ip"|"ip_address"|"raw_ip"|"user_agent"/i);
  assert.match(migration, /"visitor_id" text NOT NULL/);
  assert.match(migration, /"device" text NOT NULL/);
});
test("visitor_id and device are constrained at the database level, not merely at the application layer", () => {
  assert.match(migration, /CONSTRAINT "analytics_events_visitor_ck" CHECK \("analytics_events"\."visitor_id" ~/);
  assert.match(migration, /CONSTRAINT "analytics_events_device_ck" CHECK \("analytics_events"\."device" IN \('mobile','tablet','desktop'\)\)/);
});
test("product_id is a real foreign key to products, so 'top products' can never show a product that does not exist", () => {
  assert.match(migration, /FOREIGN KEY \("product_id"\) REFERENCES "public"\."products"\("id"\)/);
});
