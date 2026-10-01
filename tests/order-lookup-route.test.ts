/**
 * HTTP acceptance for the REAL POST /api/orders/lookup handler (app/api/orders/lookup/route.ts).
 *
 * tests/order-lookup.test.ts covers the lookup logic against a hand-written store and
 * tests/orders-db.test.ts runs the real SQL against PostgreSQL; neither executes the route itself, so
 * the response contract - status, headers, body shape, error mapping, rate-limit wiring and read-only
 * behaviour - was only ever asserted by reading the source. This file runs the real handler through the
 * existing order-route harness (tests/support/order-route-hooks.mjs + order-route-fakes.ts), the same way
 * tests/order-marketing-consent.test.ts runs the real POST /api/orders handler.
 */
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { register } from "node:module";
import { resetState, state } from "./support/order-route-fakes.ts";
import type { OrderLookupItemRow, OrderLookupRow } from "../lib/order-lookup.ts";

register("./support/order-route-hooks.mjs", import.meta.url);
const { POST } = await import("../app/api/orders/lookup/route.ts");

const ORDER_NUMBER = "ETS-20260203-AB12CD";
const EMAIL = "ada@example.com";
const INTERNAL_ID = "order-internal-uuid-0001";
const createdAt = new Date("2026-02-03T04:05:06.000Z");
/** Exactly what the storefront is allowed to see - the public projection, nothing else. */
const PUBLIC_KEYS = [
  "orderNumber", "status", "statusLabel", "createdAt", "items",
  "subtotal", "vatTotal", "shippingTotal", "installationTotal", "total", "delivery",
].sort();
const DELIVERY_KEYS = ["name", "phone", "email", "city", "district", "address", "installation", "method"].sort();
const ITEM_KEYS = ["lineTotal", "productName", "quantity", "unitPrice"];

/** The store row lib/order-lookup-db.ts projects - plus fields the projection must never carry through. */
function storedOrder(over: Partial<OrderLookupRow> = {}): OrderLookupRow {
  return {
    internalId: INTERNAL_ID, orderNumber: ORDER_NUMBER, email: "Ada@Example.com", status: "pending_payment", createdAt,
    customerName: "Ada Lovelace", phone: "05001112233", city: "İzmir", address: "Kuşadası Mahallesi 1 Sokak No 1",
    installationPreference: "included_standard",
    shippingAddressSnapshot: { recipientName: "Ada Lovelace", phone: "05001112233", city: "İzmir", district: "Kuşadası", line1: "Kuşadası Mahallesi 1 Sokak No 1", delivery: { method: "dealer", region: "service", shippingFee: 0, installationIncluded: true } },
    subtotal: 10_000, vatTotal: 2_000, shippingTotal: 0, installationTotal: 0, total: 12_000,
    // provider, payment, account and internal columns a careless projection might echo back
    provider: "paytr", providerTransactionId: "tx-secret", paymentStatus: "captured", customerId: "cust-1", idempotencyKey: "idem-secret",
    ...over,
  } as OrderLookupRow;
}

const storedItems: OrderLookupItemRow[] = [
  { productName: "Airy 12000", quantity: 2, unitPrice: 6_000, lineTotal: 12_000 },
  { productName: "Airy 9000", quantity: 1, unitPrice: 4_000, lineTotal: 4_000 },
];

function lookup(body: unknown) {
  return POST(new Request("https://magaza.ege-teknik.com/api/orders/lookup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  resetState();
  state.lookupOrder = storedOrder();
  state.lookupItems = storedItems;
});

test("a matching order returns 200, no-store and only the public projection", async () => {
  const response = await lookup({ orderNumber: ORDER_NUMBER, email: EMAIL });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");

  const body = await response.json() as { ok: boolean; order: Record<string, unknown> };
  assert.equal(body.ok, true);
  assert.deepEqual(Object.keys(body).sort(), ["ok", "order"]);
  assert.deepEqual(Object.keys(body.order).sort(), PUBLIC_KEYS);
  assert.deepEqual(Object.keys(body.order.delivery as object).sort(), DELIVERY_KEYS);
  for (const item of body.order.items as Record<string, unknown>[]) {
    assert.deepEqual(Object.keys(item).sort(), ITEM_KEYS);
  }
  // no internal id, provider, payment or account data anywhere in the payload
  const serialized = JSON.stringify(body);
  for (const leak of [INTERNAL_ID, "tx-secret", "paytr", "provider", "paymentStatus", "customerId", "idempotencyKey"]) {
    assert.ok(!serialized.includes(leak), `response must not expose ${leak}`);
  }
  assert.equal(body.order.orderNumber, ORDER_NUMBER);
  assert.equal(body.order.total, 12_000);
  assert.equal((body.order.items as unknown[]).length, 2);
  // The proof matched the order's own e-mail snapshot (trimmed, Turkish-lowercased, hashed - PayTR's rule),
  // so the store was asked for the order and then for that order's items, in that order and nothing else.
  assert.deepEqual(state.storeCalls, [`find:${ORDER_NUMBER}`, `items:${INTERNAL_ID}`]);
});

test("ownership refusals are indistinguishable: unknown order, wrong e-mail, empty stored e-mail", async () => {
  const bodies: string[] = [];
  const codes: number[] = [];
  const cases: (() => Promise<Response>)[] = [
    async () => { state.lookupOrder = null; return lookup({ orderNumber: ORDER_NUMBER, email: EMAIL }); },
    async () => lookup({ orderNumber: ORDER_NUMBER, email: "other@example.com" }),
    async () => { state.lookupOrder = storedOrder({ email: "" }); return lookup({ orderNumber: ORDER_NUMBER, email: EMAIL }); },
  ];
  for (const run of cases) {
    const response = await run();
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
    bodies.push(await response.text());
    codes.push(response.status);
  }
  assert.deepEqual(codes, [404, 404, 404]);
  assert.equal(new Set(bodies).size, 1, "the three refusals must be byte-identical");
  // a wrong e-mail must not even read the order's items
  assert.deepEqual(state.storeCalls, [`find:${ORDER_NUMBER}`, `find:${ORDER_NUMBER}`, `find:${ORDER_NUMBER}`]);
});

test("invalid input is refused with 400 before persistence is reached", async () => {
  for (const body of [
    { orderNumber: "ab", email: EMAIL },
    { orderNumber: ORDER_NUMBER, email: "not-an-email" },
    { orderNumber: ORDER_NUMBER },
    {},
  ]) {
    const response = await lookup(body);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json() as { code: string }).code, "INVALID_REQUEST");
  }
  assert.deepEqual(state.storeCalls, []);
});

test("card data is refused by the request-security path before persistence is reached", async () => {
  await assert.rejects(
    lookup({ orderNumber: ORDER_NUMBER, email: EMAIL, cardNumber: "4111111111111111", cvc: "123" }),
    /Kart verisi/,
  );
  assert.deepEqual(state.storeCalls, []);
});

test("the handler limits itself to 10 attempts per 15 minutes under the order-lookup scope", async () => {
  await lookup({ orderNumber: ORDER_NUMBER, email: EMAIL });
  assert.equal(state.rateLimitCalls.length, 1);
  assert.equal(state.rateLimitCalls[0].scope, "order-lookup");
  assert.equal(state.rateLimitCalls[0].limit, 10);
  assert.equal(state.rateLimitCalls[0].windowMs, 15 * 60_000);
});

test("the lookup only ever reads", async () => {
  // A successful lookup commits nothing at all, and the store it was handed exposes no write method.
  await lookup({ orderNumber: ORDER_NUMBER, email: EMAIL });
  assert.deepEqual(state.committed, []);
  assert.deepEqual(state.storeCalls, [`find:${ORDER_NUMBER}`, `items:${INTERNAL_ID}`]);
});