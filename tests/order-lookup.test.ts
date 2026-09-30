/**
 * P3-A1: the guest order lookup - a customer retrieves their own order with the order number and the
 * e-mail they gave at checkout. Pure layer only: fake stores, no database, no network, no Request.
 *
 * What this file really guards is one rule: the answer must never depend on WHICH of the three refusal
 * causes applied, and must never contain more than the allow-list the customer already saw at checkout.
 * Every refusal path is asserted byte-identical, and the route and store files are checked structurally
 * for the read-only, no-store and rate-limit contracts that cannot be exercised without a database.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sameOrderEmail } from "../lib/order-email.ts";
import { orderStatusLabel } from "../lib/order-domain.ts";
import { ORDER_LOOKUP_FAILURE, ORDER_LOOKUP_INVALID, lookupGuestOrder, orderLookupSchema, type OrderLookupItemRow, type OrderLookupRow, type OrderLookupStore } from "../lib/order-lookup.ts";

const ROUTE = "app/api/orders/lookup/route.ts";
const STORE = "lib/order-lookup-db.ts";
const routeSource = readFileSync(ROUTE, "utf8");
const storeSource = readFileSync(STORE, "utf8");
const lookupSource = readFileSync("lib/order-lookup.ts", "utf8");
/** Source with comments stripped, so a structural check inspects CODE and not prose. */
const codeOf = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\*.*$/gm, "").replace(/\/\/.*$/gm, "");

const createdAt = new Date("2026-02-03T04:05:06.000Z");
const row = (over: Partial<OrderLookupRow> = {}): OrderLookupRow => ({
  internalId: "order-internal-uuid-0001", orderNumber: "ETS-20260203-AB12CD", email: "Ada@Example.com", status: "pending_payment", createdAt,
  customerName: "Ada Lovelace", phone: "05001112233", city: "İzmir", address: "Kuşadası Mahallesi 1 Sokak No 1",
  installationPreference: "included_standard",
  shippingAddressSnapshot: { recipientName: "Ada Lovelace", phone: "05001112233", city: "İzmir", district: "Kuşadası", line1: "Kuşadası Mahallesi 1 Sokak No 1", delivery: { method: "dealer", region: "service", shippingFee: 0, installationIncluded: true } },
  subtotal: 10_000, vatTotal: 2_000, shippingTotal: 0, installationTotal: 0, total: 12_000,
  ...over,
});
const items: OrderLookupItemRow[] = [{ productName: "Airy 12000", quantity: 2, unitPrice: 6_000, lineTotal: 12_000 }];

/** A store that records what it was asked, so a test can prove items are read only AFTER ownership. */
function fakeStore(options: { order?: OrderLookupRow | null; items?: OrderLookupItemRow[] } = {}) {
  const calls: string[] = [];
  const store: OrderLookupStore = {
    findByOrderNumber: async (orderNumber) => { calls.push(`find:${orderNumber}`); return "order" in options ? options.order ?? null : row(); },
    listItemsForOrder: async (orderId) => { calls.push(`items:${orderId}`); return options.items ?? items; },
  };
  return { store, calls };
}

const lookup = (input: unknown, store: OrderLookupStore) => lookupGuestOrder(orderLookupSchema.parse(input), store);

// ---- success --------------------------------------------------------------------------------------------------------------

test("a matching order number and e-mail returns that order through the shared confirmation projection", async () => {
  const { store } = fakeStore();
  const result = await lookup({ orderNumber: "ETS-20260203-AB12CD", email: "Ada@Example.com" }, store);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.order.orderNumber, "ETS-20260203-AB12CD");
  assert.equal(result.order.status, "pending_payment");
  assert.equal(result.order.statusLabel, orderStatusLabel("pending_payment"));
  assert.equal(result.order.createdAt, createdAt.toISOString());
  assert.deepEqual(result.order.items, items);
  assert.equal(result.order.total, 12_000);
  // The confirmation carries the stored delivery facts; turning them into Turkish wording is the
  // storefront's job (deliveryMethodText), exactly as for the create and replay responses.
  assert.deepEqual(result.order.delivery, { name: "Ada Lovelace", phone: "05001112233", email: "Ada@Example.com", city: "İzmir", district: "Kuşadası", address: "Kuşadası Mahallesi 1 Sokak No 1", installation: "included_standard", method: "dealer" });
});

test("e-mail matching ignores case and surrounding whitespace, exactly like the PayTR comparison", async () => {
  const { store } = fakeStore();
  for (const typed of ["ada@example.com", "ADA@EXAMPLE.COM", " ada@example.com ", "\tAda@Example.com\n"]) {
    assert.equal((await lookup({ orderNumber: "ETS-20260203-AB12CD", email: typed }, store)).ok, true, typed);
  }
  // Both sides are folded with the SAME Turkish locale, exactly as PayTR always has. Turkish lowercasing maps
  // I to the dotless ı, so a dotted I is a genuinely different letter here: that existing rule is preserved
  // rather than papered over with fuzzy matching.
  assert.equal(sameOrderEmail("info@izmir.com", "info@IZMIR.com"), false, "the Turkish I/ı distinction is unchanged");
  assert.equal(sameOrderEmail("ada@example.com", "other@example.com"), false);
});

test("the internal order id reads the items but never reaches the response", async () => {
  const { store, calls } = fakeStore();
  const result = await lookup({ orderNumber: "ETS-20260203-AB12CD", email: "Ada@Example.com" }, store);
  assert.deepEqual(calls, ["find:ETS-20260203-AB12CD", "items:order-internal-uuid-0001"]);
  assert.equal(JSON.stringify(result).includes("order-internal-uuid-0001"), false);
  assert.deepEqual(Object.keys(result.ok ? result.order : {}).sort(), ["createdAt", "delivery", "installationTotal", "items", "orderNumber", "shippingTotal", "status", "statusLabel", "subtotal", "total", "vatTotal"]);
});

// ---- the one failure ----------------------------------------------------------------------------------------------------

test("an unknown order, a wrong e-mail and an order with no stored e-mail all return the same refusal", async () => {
  const a = await lookup({ orderNumber: "ETS-NOT-A-REAL-ORDER", email: "ada@example.com" }, fakeStore({ order: null }).store);
  const b = await lookup({ orderNumber: "ETS-20260203-AB12CD", email: "attacker@example.com" }, fakeStore().store);
  const c = await lookup({ orderNumber: "ETS-20260203-AB12CD", email: "ada@example.com" }, fakeStore({ order: row({ email: "" }) }).store);

  for (const result of [a, b, c]) {
    assert.equal(result.ok, false);
    assert.deepEqual(result.ok ? {} : { ...result.failure }, { status: 404, code: "ORDER_NOT_FOUND", error: "Sipariş bilgileri doğrulanamadı. Sipariş numarası ve e-posta adresini kontrol edin." });
  }
  // The externally visible answer is literally the same object, so there is nothing to tell apart.
  assert.equal(a.ok ? null : a.failure, b.ok ? null : b.failure);
  assert.equal(b.ok ? null : b.failure, c.ok ? null : c.failure);
  assert.equal(ORDER_LOOKUP_FAILURE.code, "ORDER_NOT_FOUND");
});

test("a wrong e-mail never even reads the order's items", async () => {
  const { store, calls } = fakeStore();
  await lookup({ orderNumber: "ETS-20260203-AB12CD", email: "attacker@example.com" }, store);
  assert.deepEqual(calls, ["find:ETS-20260203-AB12CD"]);
});

// ---- validation, before any lookup --------------------------------------------------------------------------------------

test("a malformed e-mail or order number is refused before the store is ever asked", () => {
  for (const input of [
    { orderNumber: "ETS-20260203-AB12CD", email: "not-an-email" },
    { orderNumber: "no", email: "ada@example.com" },
    { orderNumber: "ETS 2026/03'", email: "ada@example.com" },
    { orderNumber: "ETS-20260203-AB12CD" },
    { orderNumber: "x".repeat(41), email: "ada@example.com" },
    { orderNumber: "ETS-20260203-AB12CD", email: `${"a".repeat(140)}@example.com` },
  ]) {
    assert.equal(orderLookupSchema.safeParse(input).success, false, JSON.stringify(input));
  }
  assert.equal(ORDER_LOOKUP_INVALID.status, 400);
  assert.equal(orderLookupSchema.parse({ orderNumber: " ETS-20260203-AB12CD ", email: " Ada@Example.com " }).orderNumber, "ETS-20260203-AB12CD");
  assert.equal(orderLookupSchema.parse({ orderNumber: " ETS-1 ", email: " Ada@Example.com " }).email, "Ada@Example.com");
});

test("a client-supplied id can never stand in for ownership", async () => {
  const { store, calls } = fakeStore();
  const parsed = orderLookupSchema.parse({ orderNumber: "ETS-20260203-AB12CD", email: "Ada@Example.com", id: "order-internal-uuid-0001" });
  assert.equal("id" in parsed, false, "an id in the body is not part of the schema, so it cannot reach a query");
  await lookupGuestOrder(parsed, store);
  assert.deepEqual(calls, ["find:ETS-20260203-AB12CD", "items:order-internal-uuid-0001"]);
});

// ---- the route and store contracts, structurally (no database needed) --------------------------------------------------

test("the route is POST-only, rate limited, uncacheable, and free of any session or cookie use", () => {
  assert.match(routeSource, /rateLimit\(request, "order-lookup", 10, 15 \* 60_000\)/, "10 attempts per 15 minutes per IP");
  assert.match(routeSource, /export const POST = publicRoute\(/);
  assert.doesNotMatch(routeSource, /export const GET/, "no GET, so the e-mail credential can never travel in a URL");
  assert.match(routeSource, /readJson\(request\)/, "shared body-size, malformed-JSON and card-data rejection");
  assert.match(routeSource, /"cache-control": "no-store"/);
  assert.match(routeSource, /response\.headers\.set\("cache-control", "no-store"\)/, "every answer, including 429 and 500, is uncacheable");
  for (const forbidden of [/cookies/i, /"cookie"/i, /auth\(\)/, /clerk/i, /set-cookie/i]) assert.doesNotMatch(codeOf(routeSource), forbidden);
  for (const forbidden of [/\.insert\(/, /\.update\(/, /\.delete\(/, /transaction/i, /for\s*\(\s*"?update/i, /onConflict/]) assert.doesNotMatch(codeOf(routeSource), forbidden);
  // No new security-policy exemption, no CSP or header change, no new external origin.
  for (const forbidden of [/process\.env/, /NEXT_PUBLIC/, /https?:\/\//]) assert.doesNotMatch(codeOf(routeSource), forbidden);
});

test("the store selects only what the projection needs - nothing private is even read", () => {
  assert.match(storeSource, /eq\(orders\.orderNumber, orderNumber\)/);
  assert.match(storeSource, /\.limit\(1\)/);
  assert.match(storeSource, /eq\(orderItems\.orderId, orderId\)/, "items are read by the MATCHED order's own id");
  for (const allowed of ["orders.orderNumber", "orders.email", "orders.status", "orders.createdAt", "orders.customerName", "orders.phone", "orders.city", "orders.address", "orders.installationPreference", "orders.shippingAddressSnapshot", "orders.subtotal", "orders.vatTotal", "orders.shippingTotal", "orders.installationTotal", "orders.total", "orderItems.productName", "orderItems.quantity", "orderItems.unitPrice", "orderItems.lineTotal"]) {
    assert.ok(storeSource.includes(allowed), allowed);
  }
  for (const forbidden of ["orders.idempotencyKey", "orders.requestFingerprint", "orders.notes", "orders.billingAddressSnapshot", "orders.paymentStatus", "payments.", "refunds.", "shipments.", "customers.", "auditLogs", "adminUsers", "orderItems.productSnapshot", "orderItems.vatAmount", "orderItems.productId"]) {
    assert.equal(storeSource.includes(forbidden), false, forbidden);
  }
  // Read-only end to end: the whole lookup path is SELECTs.
  for (const source of [lookupSource, storeSource, routeSource]) {
    for (const verb of [/\.insert\(/, /\.update\(/, /\.delete\(/, /onConflict/, /for\s*\(\s*"?update/i]) assert.doesNotMatch(source, verb);
  }
});

test("the e-mail comparison is the one shared helper, and PayTR's own semantics are untouched", () => {
  const paytrSource = readFileSync("lib/paytr-db.ts", "utf8");
  assert.match(paytrSource, /import \{ sameOrderEmail \} from "\.\/order-email\.ts"/);
  assert.match(paytrSource, /!sameOrderEmail\(order\.email, input\.email\)/, "the ownership check must still be the shared helper");
  assert.equal(/const sameEmail\s*=/.test(paytrSource), false, "no second comparison left behind in paytr-db");
  assert.equal(/createHash|timingSafeEqual/.test(paytrSource), false, "the hashing primitives live in the shared module only");
  assert.equal(sameOrderEmail("Ada@Example.com", "ada@example.com"), true);
  assert.equal(sameOrderEmail("Ada@Example.com", " ada@example.com "), true);
  assert.equal(sameOrderEmail("Ada@Example.com", "ada@example.co"), false);
});