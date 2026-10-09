import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveScopedDatabaseUrl, scopedCheckoutEnabled } from "../lib/db-access-scope.ts";

const legacy = "postgresql://owner:legacy-secret@db.example.test/app";
const storefront = "postgresql://storefront_role:store-secret@db.example.test/app";
const admin = "postgresql://admin_role:admin-secret@db.example.test/app";
const configured = { DATABASE_URL: legacy, STOREFRONT_DATABASE_URL: storefront, ADMIN_DATABASE_URL: admin };

test("scoped connections resolve to distinct role-specific URLs", () => {
  assert.equal(resolveScopedDatabaseUrl("storefront", configured), storefront);
  assert.equal(resolveScopedDatabaseUrl("admin", configured), admin);
});

test("no scope silently falls back to the legacy connection", () => {
  assert.throws(() => resolveScopedDatabaseUrl("storefront", { DATABASE_URL: legacy }), /Both scoped database connections/);
  assert.throws(() => resolveScopedDatabaseUrl("admin", { DATABASE_URL: legacy }), /Both scoped database connections/);
});

test("both scopes must use distinct PostgreSQL role names", () => {
  assert.throws(() => resolveScopedDatabaseUrl("admin", { ...configured, ADMIN_DATABASE_URL: storefront }), /different PostgreSQL roles/);
  assert.throws(() => resolveScopedDatabaseUrl("admin", { ...configured, ADMIN_DATABASE_URL: "postgresql://storefront_role:other-secret@other.example.test/app" }), /different PostgreSQL roles/);
});

test("scoped connections cannot reuse the legacy owner role", () => {
  assert.throws(() => resolveScopedDatabaseUrl("storefront", { ...configured, STOREFRONT_DATABASE_URL: legacy }), /cannot reuse the legacy/);
  assert.throws(() => resolveScopedDatabaseUrl("admin", { ...configured, ADMIN_DATABASE_URL: "postgresql://owner:another-secret@db.example.test/app" }), /cannot reuse the legacy/);
});

test("invalid URLs and scopes fail closed without leaking credentials", () => {
  for (const bad of ["", "not-a-url", "https://user:secret@example.test/db", "postgresql://example.test/db"]) {
    try { resolveScopedDatabaseUrl("storefront", { ...configured, STOREFRONT_DATABASE_URL: bad }); assert.fail("expected rejection"); }
    catch (error) { assert.doesNotMatch(String(error), /store-secret|admin-secret|legacy-secret|:secret@/); }
  }
  assert.throws(() => resolveScopedDatabaseUrl("root" as "admin", configured), /Invalid database access scope/);
});

test("legacy callers remain unchanged; scoped helpers are opt-in", () => {
  const source = readFileSync("db/index.ts", "utf8");
  assert.match(source, /export function getDb\(\) \{ return drizzle\(getPool\(\), \{ schema \}\); \}/);
  assert.match(source, /export function getStorefrontDb\(\)/);
  assert.match(source, /export function getAdminDb\(\)/);
  assert.match(source, /assertEnvironmentIsolation\(\);\s*const connectionString = resolveScopedDatabaseUrl/);
});

test("checkout scope is opt-in and invalid flags fail closed", () => {
  assert.equal(scopedCheckoutEnabled(undefined), false);
  assert.equal(scopedCheckoutEnabled(""), false);
  assert.equal(scopedCheckoutEnabled("false"), false);
  assert.equal(scopedCheckoutEnabled("true"), true);
  for (const value of ["TRUE", "1", "yes", "off"]) assert.throws(() => scopedCheckoutEnabled(value), /must be true or false/);
});

test("checkout routes share the same explicitly selected database", () => {
  const orders = readFileSync("app/api/orders/route.ts", "utf8");
  const preview = readFileSync("app/api/checkout/legal-preview/route.ts", "utf8");
  assert.match(orders, /const db = getCheckoutDb\(\)/);
  assert.match(preview, /const db = getCheckoutDb\(\)/);
  assert.match(preview, /resolveCheckoutPreflight\(\{ data: parsed\.data \}, requested, db\)/);
  assert.match(preview, /resolveCheckoutCalculation\(\{ data: parsed\.data \}, requested, preflight\.requiredLegal, db\)/);
  assert.match(preview, /loadRequiredCheckoutLegalDocuments\(orderIssuedAt, db\)/);
  const index = readFileSync("db/index.ts", "utf8");
  assert.match(index, /scopedCheckoutEnabled\(process\.env\.CHECKOUT_SCOPED_DB_ENABLED\) \? getStorefrontDb\(\) : getDb\(\)/);
  assert.match(readFileSync("tests/support/order-route-fakes.ts", "utf8"), /export function getCheckoutDb\(\)/);
});

test("scoped endpoints must remain on the same database and branch", () => {
  assert.throws(() => resolveScopedDatabaseUrl("storefront", { ...configured, STOREFRONT_DATABASE_URL: "postgresql://storefront_role:secret@another.example.test/app" }), /endpoints must match/);
  assert.throws(() => resolveScopedDatabaseUrl("admin", { ...configured, ADMIN_DATABASE_URL: "postgresql://admin_role:secret@db.example.test/other" }), /endpoints must match/);
  assert.throws(() => resolveScopedDatabaseUrl("admin", { STOREFRONT_DATABASE_URL: storefront, ADMIN_DATABASE_URL: admin }), /DATABASE_URL is required/);
  const direct = "postgresql://owner:secret@ep-example.c-12.us-east-1.aws.neon.tech/neondb";
  const pooledStorefront = "postgresql://storefront_role:secret@ep-example-pooler.c-12.us-east-1.aws.neon.tech/neondb";
  const directAdmin = "postgresql://admin_role:secret@ep-example.c-12.us-east-1.aws.neon.tech/neondb";
  assert.equal(resolveScopedDatabaseUrl("storefront", { DATABASE_URL: direct, STOREFRONT_DATABASE_URL: pooledStorefront, ADMIN_DATABASE_URL: directAdmin }), pooledStorefront);
});
