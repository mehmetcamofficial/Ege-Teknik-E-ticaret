/**
 * Marketing permission is closed until the İYS / izin-ret flow is ready: checkout collects none, and
 * the order API must not record one either - not even for a hand-crafted request.
 *
 * These tests run the REAL POST /api/orders handler (request validation, idempotency, legal acceptance,
 * pricing, delivery plan and the order transaction) against the in-memory infrastructure in
 * support/order-route-fakes.ts, and assert on the rows the handler actually writes. The fake database
 * commits a transaction's writes only when it succeeds, so `state.committed` is what would persist.
 */
import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { register } from "node:module";
import test, { beforeEach } from "node:test";
import { finalizeOrderTotals } from "../lib/checkout-charges.ts";
import { DISTRICTS_BY_PROVINCE, planDelivery } from "../lib/delivery.ts";
import { computeOrderTotals, orderRequestFingerprint, orderRequestSchema, priceOrderLines } from "../lib/order-domain.ts";
import { resetState, state } from "./support/order-route-fakes.ts";

register("./support/order-route-hooks.mjs", import.meta.url);
const { POST } = await import("../app/api/orders/route.ts");

const PRODUCT = { id: "synthetic-ac-12000", name: "Sentetik Klima 12000 BTU/h", sku: "SYN-12000", slug: "synthetic-ac-12000", category: "Duvar Tipi", capacity: "12000 BTU/h", price: 30_000, vatRateBps: 2000, deliveryClass: "installed_delivery", status: "published", saleMode: "online" };
const REQUIRED = [{ slug: "distance-sales", title: "Mesafeli Satış Sözleşmesi", versionId: "ver-distance-sales" }, { slug: "pre-information", title: "Ön Bilgilendirme Formu", versionId: "ver-pre-information" }];
const PROVINCE = "İzmir";
const DISTRICT = DISTRICTS_BY_PROVINCE[PROVINCE][0];

// The total the storefront shows, computed with the same functions the route uses.
const plan = planDelivery({ classes: [PRODUCT.deliveryClass], province: PROVINCE, district: DISTRICT });
assert.ok(plan.ok, "fixture: the synthetic order must be deliverable");
const EXPECTED_TOTAL = finalizeOrderTotals(computeOrderTotals(priceOrderLines([PRODUCT], new Map([[PRODUCT.id, 1]]))), plan.plan.shipping).total;

const payload = (extra: Record<string, unknown> = {}) => ({
  customerName: "Test Müşteri", phone: "05000000000", email: "test@example.test", city: PROVINCE, district: DISTRICT,
  address: "Test Mahallesi 1. Sokak No 1", paymentProvider: "discovery", items: [{ productId: PRODUCT.id, quantity: 1 }],
  expectedTotal: EXPECTED_TOTAL, legalAcceptances: REQUIRED.map((version) => version.versionId), ...extra,
});

let requests = 0;
async function post(body: unknown, key = `marketing-consent-test-${++requests}`) {
  const response = await POST(new Request("https://shop.test/api/orders", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body) }));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}
const written = () => state.committed.map((write) => write.table).sort();
const marketingConsentRows = () => state.committed.filter((write) => write.table === "marketing_consents");

beforeEach(() => {
  resetState();
  state.products = [PRODUCT];
  state.required = REQUIRED;
});

// ---- normal checkout keeps working ---------------------------------------------------------------
test("a normal checkout without any marketing field still creates the order - and no marketing_consents row", async () => {
  const res = await post(payload());
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);
  assert.equal(res.body.total, EXPECTED_TOTAL);
  assert.deepEqual(written(), ["addresses", "customers", "inventory", "order_items", "order_legal_acceptances", "orders"]);
  assert.deepEqual(marketingConsentRows(), []);
});

test("the legal acceptances are still recorded, one row per required version", async () => {
  await post(payload());
  const acceptances = state.committed.filter((write) => write.table === "order_legal_acceptances").flatMap((write) => write.values as { documentVersionId: string }[]);
  assert.deepEqual(acceptances.map((row) => row.documentVersionId).sort(), REQUIRED.map((version) => version.versionId).sort());
});

test("the storefront's own all-false marketing object is accepted and records no consent", async () => {
  const res = await post(payload({ marketing: { sms: false, email: false, whatsapp: false } }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.deepEqual(marketingConsentRows(), []);
});

// ---- any explicit opt-in is refused, never recorded ----------------------------------------------
const OPT_INS: [string, Record<string, boolean>][] = [
  ["sms", { sms: true }],
  ["email", { email: true }],
  ["WhatsApp", { whatsapp: true }],
  ["several channels", { sms: true, whatsapp: true }],
  ["every channel", { sms: true, email: true, whatsapp: true }],
];
for (const [label, marketing] of OPT_INS) {
  test(`marketing opt-in (${label}) is refused with MARKETING_CONSENT_DISABLED and writes nothing at all`, async () => {
    const res = await post(payload({ marketing }));
    assert.equal(res.status, 422);
    assert.equal(res.body.code, "MARKETING_CONSENT_DISABLED");
    assert.match(String(res.body.error), /Pazarlama izni şu anda sipariş üzerinden alınmıyor/);
    assert.deepEqual(marketingConsentRows(), [], "no marketing_consents row");
    assert.deepEqual(state.committed, [], "no order, customer, stock or acceptance row either");
  });
}

// ---- idempotency is unchanged --------------------------------------------------------------------
function existingOrderFor(body: Record<string, unknown>) {
  const parsed = orderRequestSchema.parse(body);
  return {
    id: "order-1", orderNumber: "ETS-TEST-000001", total: EXPECTED_TOTAL, status: "pending_payment",
    // A real orders row always carries created_at (NOT NULL with a default), and the confirmation
    // projection now reports it, so the fixture must be as complete as the schema.
    createdAt: new Date("2026-02-03T04:05:06.000Z"),
    requestFingerprint: orderRequestFingerprint(parsed, new Map(parsed.items.map((item) => [item.productId, item.quantity]))),
    subtotal: EXPECTED_TOTAL, vatTotal: 0, shippingTotal: 0, installationTotal: 0, customerName: parsed.customerName, phone: parsed.phone,
    email: parsed.email, city: parsed.city, address: parsed.address, installationPreference: "none", shippingAddressSnapshot: {},
  };
}

test("an idempotent replay of a normal order still returns the original order and writes nothing new", async () => {
  state.existingOrder = existingOrderFor(payload());
  const res = await post(payload(), "replayed-order-key");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.orderNumber, "ETS-TEST-000001");
  assert.deepEqual(state.committed, []);
});

test("re-using a key with a marketing opt-in is an idempotency conflict and cannot create a consent", async () => {
  state.existingOrder = existingOrderFor(payload());
  const res = await post(payload({ marketing: { sms: true } }), "replayed-order-key");
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "IDEMPOTENCY_KEY_REUSED");
  assert.deepEqual(state.committed, []);
});

// ---- no other writer exists; the table itself stays for the future İYS integration ---------------
test("no runtime code writes marketing_consents while the İYS flow is closed, and the table stays", () => {
  const sources = [...globSync("app/**/*.ts"), ...globSync("app/**/*.tsx"), ...globSync("lib/**/*.ts")];
  assert.ok(sources.includes("app/api/orders/route.ts"));
  for (const file of sources) assert.doesNotMatch(readFileSync(file, "utf8"), /insert\(marketingConsents\)/, file);
  assert.match(readFileSync("db/schema.ts", "utf8"), /export const marketingConsents=pgTable\("marketing_consents"/);
  assert.match(readFileSync("drizzle-pg/0006_checkout_charges_and_marketing_consents.sql", "utf8"), /CREATE TABLE "marketing_consents"/);
});
