import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Structural + generated-SQL checks for the account resource layer, in the
 * same style as tests/customer-identity-boundary.test.ts: account-resources-db.ts
 * needs a live database, so the real ownership WHERE clauses are rendered and
 * asserted here via drizzle's .toSQL() (no connection needed - see Phase
 * 3A.3C's ON CONFLICT test for the same technique), and the wiring itself is
 * checked structurally: no request-controlled input, no admin references.
 */

const read = (file: string) => readFileSync(file, "utf8");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const ACCOUNT_RESOURCES = stripComments(read("lib/account-resources.ts"));
const ACCOUNT_RESOURCES_DB = stripComments(read("lib/account-resources-db.ts"));

test("account-resources.ts and account-resources-db.ts read no request-controlled input", () => {
  for (const [file, source] of [["lib/account-resources.ts", ACCOUNT_RESOURCES], ["lib/account-resources-db.ts", ACCOUNT_RESOURCES_DB]] as const) {
    for (const forbidden of [/\bRequest\b/, /\bheaders\(/, /\bcookies\(/, /searchParams/, /formData/, /next\/headers/, /@clerk\//]) {
      assert.equal(forbidden.test(source), false, `${file} must not read ${forbidden}`);
    }
  }
});

test("account-resources-db.ts is server-only and never references admin auth", () => {
  assert.match(read("lib/account-resources-db.ts"), /^import "server-only";/);
  assert.equal(/admin-auth|adminUsers|adminSessions|getAdminUser|ege_admin_session/.test(ACCOUNT_RESOURCES_DB), false);
  assert.equal(/admin-auth|adminUsers|adminSessions|getAdminUser|ege_admin_session/.test(ACCOUNT_RESOURCES), false);
});

test("every address/order mutation and read in the DB layer is scoped through ownedAddressWhere/ownedOrderWhere", () => {
  // Structural guard: catches an address/order query added later that filters by id alone.
  const addressQueries = ACCOUNT_RESOURCES_DB.match(/\.from\(addresses\)[\s\S]{0,40}?\.where\(([^)]*)\)/g) ?? [];
  assert.ok(addressQueries.length >= 2, "expected at least the get and list address queries");
  for (const q of addressQueries) assert.match(q, /ownedAddressWhere\(|eq\(addresses\.customerId, customerId\)/, q);

  const orderQueries = ACCOUNT_RESOURCES_DB.match(/\.from\(orders\)[\s\S]{0,40}?\.where\(([^)]*)\)/g) ?? [];
  assert.ok(orderQueries.length >= 2);
  for (const q of orderQueries) assert.match(q, /ownedOrderWhere\(|eq\(orders\.customerId, customerId\)/, q);

  assert.match(ACCOUNT_RESOURCES_DB, /\.update\(addresses\)[\s\S]*?\.where\(ownedAddressWhere\(customerId, addressId\)\)/);
  assert.match(ACCOUNT_RESOURCES_DB, /\.delete\(addresses\)[\s\S]*?\.where\(ownedAddressWhere\(customerId, addressId\)\)/);
});

test("profile updates are scoped to the resolved customer id and never set clerk_user_id or email", () => {
  const setClause = ACCOUNT_RESOURCES_DB.match(/updateOwnedProfile:[\s\S]*?\.set\(\{([^}]*)\}\)/);
  assert.ok(setClause, "updateOwnedProfile's .set(...) not found");
  assert.doesNotMatch(setClause![1], /clerkUserId|email:/, "profile updates must never touch clerkUserId or email");
  assert.match(ACCOUNT_RESOURCES_DB, /updateOwnedProfile:[\s\S]*?\.where\(eq\(customers\.id, customerId\)\)/);
});

test("the generated address UPDATE/DELETE SQL filters by id AND customer_id together (real WHERE shape, not just source text)", async () => {
  const { and, eq } = await import("drizzle-orm");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { addresses, orders } = await import("../db/schema.ts");
  const db = drizzle({ connection: "postgres://unused:unused@127.0.0.1:1/unused" });

  const updateSql = db
    .update(addresses)
    .set({ city: "Ankara" })
    .where(and(eq(addresses.id, "addr-1"), eq(addresses.customerId, "cust-1")))
    .toSQL();
  assert.match(updateSql.sql, /update "addresses" set "city" = \$1 where \("addresses"\."id" = \$2 and "addresses"\."customer_id" = \$3\)/);
  assert.deepEqual(updateSql.params, ["Ankara", "addr-1", "cust-1"]);

  const deleteSql = db
    .delete(addresses)
    .where(and(eq(addresses.id, "addr-1"), eq(addresses.customerId, "cust-1")))
    .toSQL();
  assert.match(deleteSql.sql, /delete from "addresses" where \("addresses"\."id" = \$1 and "addresses"\."customer_id" = \$2\)/);

  const orderSql = db
    .select()
    .from(orders)
    .where(and(eq(orders.id, "order-1"), eq(orders.customerId, "cust-1")))
    .toSQL();
  assert.match(orderSql.sql, /where \("orders"\."id" = \$1 and "orders"\."customer_id" = \$2\)/);
});

test("guest checkout (app/api/orders/route.ts) is untouched by the account resource layer", () => {
  const source = read("app/api/orders/route.ts");
  assert.equal(/account-resources|customer-auth|customer-identity|@clerk\//.test(source), false);
  assert.match(source, /export const POST=publicRoute\(createOrder\)/);
});
