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
  for (const [file, source] of [["lib/account-resources.ts", ACCOUNT_RESOURCES], ["lib/account-resources-db.ts", ACCOUNT_RESOURCES_DB], ["lib/account-queries.ts", stripComments(read("lib/account-queries.ts"))]] as const) {
    for (const forbidden of [/\bRequest\b/, /\bheaders\(/, /\bcookies\(/, /searchParams/, /formData/, /next\/headers/, /@clerk\//]) {
      assert.equal(forbidden.test(source), false, `${file} must not read ${forbidden}`);
    }
  }
});

test("account-resources-db.ts is server-only and never references admin auth", () => {
  assert.match(read("lib/account-resources-db.ts"), /^import "server-only";/);
  assert.equal(/admin-auth|adminUsers|adminSessions|getAdminUser|ege_admin_session/.test(ACCOUNT_RESOURCES_DB), false);
  assert.equal(/admin-auth|adminUsers|adminSessions|getAdminUser|ege_admin_session/.test(ACCOUNT_RESOURCES), false);
  assert.equal(/admin-auth|adminUsers|adminSessions|getAdminUser|ege_admin_session/.test(read("lib/account-queries.ts")), false);
});

test("every address/order mutation and read in the DB layer is scoped through ownedAddressWhere/ownedOrderWhere", () => {
  // Structural guard, kept as defense in depth next to tests/account-queries.test.ts (which renders the
  // real queries): catches an address/order query added later that filters by id alone.
  const queries = stripComments(read("lib/account-queries.ts"));
  const addressQueries = ACCOUNT_RESOURCES_DB.match(/\.from\(addresses\)[\s\S]{0,40}?\.where\(([^)]*)\)/g) ?? [];
  assert.ok(addressQueries.length >= 2, "expected at least the get and list address queries");
  for (const q of addressQueries) assert.match(q, /ownedAddressWhere\(|eq\(addresses\.customerId, customerId\)/, q);

  const orderQueries = queries.match(/\.from\(orders\)[\s\S]{0,40}?\.where\(([^)]*)\)/g) ?? [];
  assert.ok(orderQueries.length >= 2, "expected the order detail and list queries in lib/account-queries.ts");
  for (const q of orderQueries) assert.match(q, /ownedOrderWhere\(|eq\(orders\.customerId, customerId\)/, q);
  assert.equal(/\.from\(orders\)/.test(ACCOUNT_RESOURCES_DB), false, "order queries must be built in lib/account-queries.ts, where they are tested");

  assert.match(ACCOUNT_RESOURCES_DB, /\.update\(addresses\)[\s\S]*?\.where\(ownedAddressWhere\(customerId, addressId\)\)/);
  assert.match(ACCOUNT_RESOURCES_DB, /\.delete\(addresses\)[\s\S]*?\.where\(ownedAddressWhere\(customerId, addressId\)\)/);
});

test("profile updates are scoped to the resolved customer id and never set clerk_user_id or email", () => {
  const setClause = ACCOUNT_RESOURCES_DB.match(/updateOwnedProfile:[\s\S]*?\.set\(\{([^}]*)\}\)/);
  assert.ok(setClause, "updateOwnedProfile's .set(...) not found");
  assert.doesNotMatch(setClause![1], /clerkUserId|email:/, "profile updates must never touch clerkUserId or email");
  assert.match(ACCOUNT_RESOURCES_DB, /updateOwnedProfile:[\s\S]*?\.where\(eq\(customers\.id, customerId\)\)/);
});

test("guest checkout (app/api/orders/route.ts) is untouched by the account resource layer", () => {
  const source = read("app/api/orders/route.ts");
  assert.equal(/account-resources|customer-auth|customer-identity|@clerk\//.test(source), false);
  assert.match(source, /export const POST=publicRoute\(createOrder\)/);
});

// --- Phase 3A.3E hardening -------------------------------------------------

test("all four account mutations go through runAccountMutation with their own rate-limit scope, via the existing rateLimit()", () => {
  // The ordering itself (limit -> identity -> write, each short-circuiting) is proven
  // behaviourally in tests/account-queries.test.ts; this pins every action to that sequence.
  const guard = read("lib/account-action-guard.ts");
  assert.match(guard, /import\s*\{[^}]*\brateLimit\b[^}]*\}\s*from\s*"@\/lib\/http-security"/, "must reuse rateLimit(), not a second system");
  const sources = { profile: read("app/account/profile/actions.ts"), address: read("app/account/addresses/actions.ts") };
  for (const [file, fn, scope] of [["profile", "updateProfileAction", "account-profile-update"], ["address", "createAddressAction", "account-address-create"], ["address", "updateAddressAction", "account-address-update"], ["address", "deleteAddressAction", "account-address-delete"]] as const) {
    const body = sources[file].match(new RegExp(`export async function ${fn}[\\s\\S]*?\\n}`))?.[0];
    assert.ok(body, `${fn} not found`);
    assert.match(body, /runAccountMutation\(\{/, `${fn} must use the shared mutation sequence`);
    assert.match(body, new RegExp(`rateLimit: (limit\\("${scope}"\\)|\\(\\) => rateLimitAccountAction\\("${scope}")`), `${fn} must rate-limit with scope ${scope}`);
    assert.match(body, /resolveCustomer: getAuthenticatedCustomer/, `${fn} must take identity from the verified session`);
    assert.doesNotMatch(body, /formData\.get\("customerId"\)|customerId:/, `${fn} must never read a client customerId`);
  }
});

test("deleteAddressAction returns the store's generic failure verbatim (non-enumerable), never a distinguishing detail", () => {
  const body = read("app/account/addresses/actions.ts").match(/export async function deleteAddressAction[\s\S]*?\n}/)![0];
  assert.match(body, /Promise<DeleteAddressResult>/);
  assert.match(body, /return result;/);
  assert.equal(/status|stack|internal|database/i.test(body), false);
});
