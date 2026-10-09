import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveScopedDatabaseUrl } from "../lib/db-access-scope.ts";

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
