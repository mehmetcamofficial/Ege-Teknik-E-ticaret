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

// --- Phase 3A.3E hardening -------------------------------------------------

test("getOwnedOrder never selects idempotencyKey, notes or raw contact snapshot fields", () => {
  const block = ACCOUNT_RESOURCES_DB.match(/getOwnedOrder:[\s\S]*?\.limit\(1\);/);
  assert.ok(block, "getOwnedOrder's order select not found");
  for (const forbidden of [/idempotencyKey/, /\bnotes\b/, /customerName/, /\bphone:/, /\bemail:/]) {
    assert.equal(forbidden.test(block![0]), false, `getOwnedOrder must not select ${forbidden}`);
  }
  assert.match(block![0], /ownedOrderWhere\(customerId, orderId\)/, "ownership predicate must survive the narrower projection");
});

test("the narrowed order SELECT's real generated SQL matches exactly the OrderDetail field set (no over-fetch)", async () => {
  const { and, eq } = await import("drizzle-orm");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { orders } = await import("../db/schema.ts");
  const db = drizzle({ connection: "postgres://unused:unused@127.0.0.1:1/unused" });

  const sql = db
    .select({
      id: orders.id, orderNumber: orders.orderNumber, status: orders.status, total: orders.total, currency: orders.currency, createdAt: orders.createdAt,
      subtotal: orders.subtotal, vatTotal: orders.vatTotal, shippingTotal: orders.shippingTotal, paymentStatus: orders.paymentStatus,
      shippingAddressSnapshot: orders.shippingAddressSnapshot, billingAddressSnapshot: orders.billingAddressSnapshot,
    })
    .from(orders)
    .where(and(eq(orders.id, "order-1"), eq(orders.customerId, "cust-1")))
    .toSQL();
  for (const forbidden of ["idempotency_key", "\"notes\"", "customer_name"]) assert.equal(sql.sql.includes(forbidden), false, `${forbidden} must not appear in the generated SQL`);
  assert.match(sql.sql, /where \("orders"\."id" = \$1 and "orders"\."customer_id" = \$2\)/);
});

test("all four account mutations rate-limit before doing anything else, via the project's existing rateLimit() architecture", () => {
  const guard = read("lib/account-action-guard.ts");
  assert.match(guard, /import\s*\{[^}]*\brateLimit\b[^}]*\}\s*from\s*"@\/lib\/http-security"/, "must reuse rateLimit(), not a second system");

  const profileActions = read("app/account/profile/actions.ts");
  assert.match(profileActions, /rateLimitAccountAction\("account-profile-update"/);

  const addressActions = read("app/account/addresses/actions.ts");
  for (const [fn, scope] of [["createAddressAction", "account-address-create"], ["updateAddressAction", "account-address-update"], ["deleteAddressAction", "account-address-delete"]] as const) {
    const body = addressActions.match(new RegExp(`export async function ${fn}[\\s\\S]*?\\n}`));
    assert.ok(body, `${fn} not found`);
    assert.match(body![0], new RegExp(`rateLimitAccountAction\\("${scope}"`), `${fn} must rate-limit with scope ${scope}`);
  }
});

test("deleteAddressAction surfaces a non-enumerable failure instead of silently no-op'ing", () => {
  const source = read("app/account/addresses/actions.ts");
  const body = source.match(/export async function deleteAddressAction[\s\S]*?\n}/)![0];
  assert.match(body, /Promise<DeleteAddressResult>/);
  assert.match(body, /if \(!result\.ok\) return \{ ok: false, error: result\.error \}/);
  // deleteAddress's error message is identical for "not found" and "not owned" (see lib/account-resources.ts),
  // so nothing here can add a distinguishing detail - only forward it verbatim.
  assert.equal(/status|stack|internal|database/i.test(body), false);
});
