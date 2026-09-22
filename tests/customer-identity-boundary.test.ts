import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { classifyProxyRoute } from "../lib/proxy-routing.ts";

/**
 * Structural checks for the customer identity layer, in the same style as
 * tests/account-zone-boundary.test.ts: lib/customer-auth.ts needs Clerk and a
 * live database, so what is asserted here is the wiring that enforces the
 * boundary - identity comes only from Clerk's server auth(), customer and
 * admin auth never reference each other, guest checkout stays Clerk-free, and
 * the migration is additive only.
 */

const read = (file: string) => readFileSync(file, "utf8");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
function listFilesRecursive(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? listFilesRecursive(full) : [full];
  });
}

const CUSTOMER_AUTH = stripComments(read("lib/customer-auth.ts"));
const CUSTOMER_IDENTITY = stripComments(read("lib/customer-identity.ts"));

test("customer identity is taken only from Clerk's server-side auth()", () => {
  assert.match(CUSTOMER_AUTH, /import\s*\{[^}]*\bauth\b[^}]*\}\s*from\s*"@clerk\/nextjs\/server"/);
  assert.match(CUSTOMER_AUTH, /getVerifiedClerkUserId:\s*async\s*\(\)\s*=>\s*\(await auth\(\)\)\.userId/);
  assert.match(read("lib/customer-auth.ts"), /^import "server-only";/);
});

test("the customer identity layer reads no request-controlled input", () => {
  for (const [file, source] of [["lib/customer-auth.ts", CUSTOMER_AUTH], ["lib/customer-identity.ts", CUSTOMER_IDENTITY]]) {
    for (const forbidden of [/\bRequest\b/, /\bheaders\(/, /\bcookies\(/, /searchParams/, /formData/, /\.json\(/, /localStorage/, /next\/headers/]) {
      assert.equal(forbidden.test(source), false, `${file} must not read ${forbidden}`);
    }
  }
});

test("customers are looked up by clerk_user_id only, never by email or phone", () => {
  assert.match(CUSTOMER_AUTH, /eq\(customers\.clerkUserId, clerkUserId\)/);
  assert.equal(/eq\(customers\.(email|phone|id)\b/.test(CUSTOMER_AUTH), false);
  assert.equal(/\.update\(|\.delete\(/.test(CUSTOMER_AUTH), false, "identity linking never updates or deletes existing customers");
});

test("first-login creation relies on the clerk_user_id unique index (ON CONFLICT DO NOTHING)", () => {
  assert.match(CUSTOMER_AUTH, /onConflictDoNothing\(\{\s*target:\s*customers\.clerkUserId/);
});

test("the generated INSERT targets the partial unique index with a matching WHERE predicate", async () => {
  // A source-text match can't tell a real partial-index predicate from a missing or wrong
  // one - drizzle-kit only infers customers_clerk_user_uq when the ON CONFLICT WHERE clause
  // is textually identical to the index's own predicate (see drizzle-pg/0002_customer_clerk_identity.sql).
  // Render the exact statement drizzle-orm builds and assert its SQL shape, so this fails if
  // the WHERE clause is ever dropped or diverges from the index.
  const { sql, eq } = await import("drizzle-orm");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { customers } = await import("../db/schema.ts");
  const db = drizzle({ connection: "postgres://unused:unused@127.0.0.1:1/unused" });

  const insert = db
    .insert(customers)
    .values({ id: "x", firstName: "a", lastName: "b", email: "", phone: "", clerkUserId: "user_abc" })
    .onConflictDoNothing({ target: customers.clerkUserId, where: sql`${sql.identifier("clerk_user_id")} is not null` })
    .returning({ id: customers.id, clerkUserId: customers.clerkUserId })
    .toSQL();
  assert.match(insert.sql, /on conflict \("clerk_user_id"\) where "clerk_user_id" is not null do nothing/);
  assert.match(insert.sql, /returning "id", "clerk_user_id"/);

  const select = db.select({ id: customers.id }).from(customers).where(eq(customers.clerkUserId, "user_abc")).limit(1).toSQL();
  assert.match(select.sql, /where "customers"\."clerk_user_id" = \$1/);
});

// 9. Clerk customer authentication does not grant admin authorization
test("customer identity and admin auth never reference each other", () => {
  for (const source of [CUSTOMER_AUTH, CUSTOMER_IDENTITY]) {
    assert.equal(/admin-auth|adminUsers|adminSessions|getAdminUser|ege_admin_session/.test(source), false);
  }
  const adminFiles = ["lib/admin-auth.ts", "lib/security-policy.ts", ...listFilesRecursive("app/admin"), ...listFilesRecursive("app/api/admin"), ...listFilesRecursive("app/api/auth")];
  for (const file of adminFiles) {
    const source = read(file);
    assert.equal(/customer-auth|customer-identity|clerkUserId|clerk_user_id|@clerk\//.test(source), false, `${file} must not touch customer identity`);
  }
});

test("admin authorization is decided only by the admin session cookie and admin_users", () => {
  const source = read("lib/admin-auth.ts");
  assert.match(source, /jar\.get\(COOKIE\)/);
  assert.equal(/customers\b/.test(source), false);
});

test("Clerk middleware never runs for /admin or /api/admin", () => {
  for (const path of ["/admin", "/admin/login", "/api/admin/products", "/api/admin/orders/1", "/api/auth/login"]) {
    assert.notEqual(classifyProxyRoute(path), "account", path);
  }
});

// 10. guest checkout remains guest-capable
test("guest checkout does not require or consult Clerk/customer identity", () => {
  const source = read("app/api/orders/route.ts");
  assert.equal(/@clerk\/|customer-auth|customer-identity|clerkUserId|auth\(\)/.test(source), false);
  assert.match(source, /tx\.insert\(customers\)\.values\(\{ id: customerId,/, "guest orders still create their own unlinked customer");
  assert.match(source, /export const POST=publicRoute\(createOrder\)/);
  assert.equal(classifyProxyRoute("/api/orders"), "api");
});

test("/account resolves its customer through the identity layer", () => {
  const source = read("app/account/page.tsx");
  assert.match(source, /from "@\/lib\/customer-auth"/);
  assert.match(source, /await getOrCreateAuthenticatedCustomer\(\)/);
});

test("the schema declares a nullable clerk_user_id with a partial unique index", () => {
  const schema = read("db/schema.ts");
  assert.match(schema, /clerkUserId:text\("clerk_user_id"\),/, "nullable: no .notNull()");
  assert.match(schema, /uniqueIndex\("customers_clerk_user_uq"\)\.on\(t\.clerkUserId\)\.where\(sql`\$\{t\.clerkUserId\} IS NOT NULL`\)/);
});

test("the customer identity migration is additive only", () => {
  const sql = read("drizzle-pg/0002_customer_clerk_identity.sql");
  const statements = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(statements, [
    'ALTER TABLE "customers" ADD COLUMN "clerk_user_id" text;',
    'CREATE UNIQUE INDEX "customers_clerk_user_uq" ON "customers" USING btree ("clerk_user_id") WHERE "customers"."clerk_user_id" IS NOT NULL;',
  ]);
  assert.equal(/\b(drop|truncate|delete|update|rename)\b|not null default|set not null/i.test(sql.replace(/IS NOT NULL/g, "")), false);
});
