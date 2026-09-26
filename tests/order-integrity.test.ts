import assert from "node:assert/strict";
import test from "node:test";
import { computeOrderTotals, orderRequestSchema, priceOrderLines, toOrderConfirmation, toPublicOrderItem } from "../lib/order-domain.ts";

const baseRequest = {
  customerName: "Ada Lovelace",
  phone: "05001112233",
  email: "ada@example.test",
  city: "İzmir",
  address: "Kuşadası Mahallesi 1 Sokak No 1",
  paymentProvider: "PayTR" as const,
  items: [{ productId: "p1", quantity: 2 }],
  expectedTotal: 1000,
};

test("a valid order request parses", () => {
  const parsed = orderRequestSchema.safeParse(baseRequest);
  assert.equal(parsed.success, true);
});

test("zero and negative quantities are rejected", () => {
  for (const quantity of [0, -1, -100]) {
    const parsed = orderRequestSchema.safeParse({ ...baseRequest, items: [{ productId: "p1", quantity }] });
    assert.equal(parsed.success, false, `quantity ${quantity} must be rejected`);
  }
});

test("fractional and non-numeric quantities are rejected", () => {
  assert.equal(orderRequestSchema.safeParse({ ...baseRequest, items: [{ productId: "p1", quantity: 1.5 }] }).success, false);
  assert.equal(orderRequestSchema.safeParse({ ...baseRequest, items: [{ productId: "p1", quantity: "2" }] }).success, false);
});

test("excessive quantities and oversized carts are rejected", () => {
  assert.equal(orderRequestSchema.safeParse({ ...baseRequest, items: [{ productId: "p1", quantity: 11 }] }).success, false);
  const tooManyLines = Array.from({ length: 21 }, (_, index) => ({ productId: `p${index}`, quantity: 1 }));
  assert.equal(orderRequestSchema.safeParse({ ...baseRequest, items: tooManyLines }).success, false);
});

test("an empty cart is rejected", () => {
  assert.equal(orderRequestSchema.safeParse({ ...baseRequest, items: [] }).success, false);
});

test("client-supplied prices, VAT and totals are stripped from the parsed request", () => {
  const parsed = orderRequestSchema.parse({
    ...baseRequest,
    total: 1,
    subtotal: 1,
    vatTotal: 0,
    items: [{ productId: "p1", quantity: 2, price: 1, unitPrice: 1, vatRateBps: 0, lineTotal: 1 }],
  });
  assert.equal("total" in parsed, false);
  assert.equal("subtotal" in parsed, false);
  assert.equal("vatTotal" in parsed, false);
  assert.deepEqual(parsed.items, [{ productId: "p1", quantity: 2 }]);
});

test("pricing uses the server product row, never a client-supplied price", () => {
  const serverProduct = { id: "p1", price: 30_000, vatRateBps: 2_000 };
  const lines = priceOrderLines([serverProduct], new Map([["p1", 2]]));
  assert.equal(lines[0].lineTotal, 60_000);
  assert.equal(lines[0].product.price, 30_000);
});

test("order totals are derived from server rows and VAT is carved out of the gross price", () => {
  const lines = priceOrderLines(
    [
      { id: "p1", price: 12_000, vatRateBps: 2_000 },
      { id: "p2", price: 30_000, vatRateBps: 2_000 },
    ],
    new Map([
      ["p1", 2],
      ["p2", 1],
    ]),
  );
  const totals = computeOrderTotals(lines);
  assert.equal(totals.total, 54_000);
  assert.equal(totals.vatTotal, 9_000);
  assert.equal(totals.subtotal, 45_000);
  assert.equal(totals.subtotal + totals.vatTotal, totals.total);
});

test("a product missing from the quantity map contributes nothing", () => {
  const lines = priceOrderLines([{ id: "p1", price: 10_000, vatRateBps: 2_000 }], new Map());
  assert.equal(lines[0].quantity, 0);
  assert.equal(computeOrderTotals(lines).total, 0);
});

test("differing VAT rates are applied per line", () => {
  const lines = priceOrderLines(
    [
      { id: "standard", price: 12_000, vatRateBps: 2_000 },
      { id: "reduced", price: 10_100, vatRateBps: 100 },
    ],
    new Map([
      ["standard", 1],
      ["reduced", 1],
    ]),
  );
  assert.equal(lines[0].vatAmount, 2_000);
  assert.equal(lines[1].vatAmount, 100);
});

// ---- guest order confirmation: what the customer sees after checkout ----------------------------
test("toPublicOrderItem is an exact allow-list: product name, quantity, unit price and line total only", () => {
  const item = toPublicOrderItem({ product: { name: "Airy 12000", id: "internal-product-id" } as never, quantity: 2, lineTotal: 24_000 }, 12_000);
  assert.deepEqual(Object.keys(item).sort(), ["lineTotal", "productName", "quantity", "unitPrice"]);
  assert.deepEqual(item, { productName: "Airy 12000", quantity: 2, unitPrice: 12_000, lineTotal: 24_000 });
});

const confirmationInput = {
  orderNumber: "ETS-20260101-ABC123", status: "pending_payment",
  items: [{ productName: "Airy 12000", quantity: 1, unitPrice: 12_000, lineTotal: 12_000 }],
  subtotal: 10_000, vatTotal: 2_000, shippingTotal: 0, installationTotal: 0, total: 12_000,
  customerName: "Ada Lovelace", phone: "05001112233", email: "ada@example.test", city: "İzmir", address: "Kuşadası Mahallesi 1 Sokak No 1",
  installation: "delivery_only",
};
test("toOrderConfirmation exposes only real order data: no order/customer/address id, no idempotency key", () => {
  const confirmation = toOrderConfirmation(confirmationInput);
  assert.deepEqual(Object.keys(confirmation).sort(), ["delivery", "installationTotal", "items", "orderNumber", "shippingTotal", "status", "subtotal", "total", "vatTotal"]);
  assert.deepEqual(Object.keys(confirmation.delivery).sort(), ["address", "city", "district", "email", "installation", "method", "name", "phone"]);
  for (const forbidden of ["id", "customerId", "addressId", "idempotencyKey", "requestFingerprint"]) {
    assert.equal(forbidden in confirmation, false, forbidden);
    assert.equal(forbidden in confirmation.delivery, false, forbidden);
  }
});
test("toOrderConfirmation carries the real values through without inventing or dropping any", () => {
  const confirmation = toOrderConfirmation(confirmationInput);
  assert.equal(confirmation.orderNumber, "ETS-20260101-ABC123");
  assert.equal(confirmation.status, "pending_payment");
  assert.deepEqual(confirmation.items, confirmationInput.items);
  assert.equal(confirmation.subtotal, 10_000);
  assert.equal(confirmation.vatTotal, 2_000);
  assert.equal(confirmation.total, 12_000);
  assert.deepEqual(confirmation.delivery, { name: "Ada Lovelace", phone: "05001112233", email: "ada@example.test", city: "İzmir", district: "", address: "Kuşadası Mahallesi 1 Sokak No 1", installation: "delivery_only", method: "" });
});
test("toOrderConfirmation copies its items array and each item, so mutating the input afterwards cannot change the response", () => {
  const items = [{ productName: "Airy 12000", quantity: 1, unitPrice: 12_000, lineTotal: 12_000 }];
  const confirmation = toOrderConfirmation({ ...confirmationInput, items });
  items[0].quantity = 99;
  items.push({ productName: "Injected", quantity: 1, unitPrice: 1, lineTotal: 1 });
  assert.equal(confirmation.items.length, 1);
  assert.equal(confirmation.items[0].quantity, 1);
});
// ---- Phase 5B.1 review: the allow-list must hold even against a caller mistake, not just clean input.
// toOrderConfirmation's parameter type has no id/customerId/addressId/idempotencyKey field, so a future
// refactor that (for example) spreads a raw DB row into it would be a type change these tests would not
// silently miss: they poison the input with those exact keys and assert they can never reach the output.
test("toOrderConfirmation never leaks an id/customerId/addressId/idempotencyKey/requestFingerprint even if such properties are smuggled onto the input object", () => {
  const poisoned = {
    ...confirmationInput,
    id: "REAL-ORDER-UUID", customerId: "REAL-CUSTOMER-UUID", addressId: "REAL-ADDRESS-UUID",
    idempotencyKey: "REAL-SECRET-KEY", requestFingerprint: "REAL-FINGERPRINT-HASH", ipHash: "should-not-leak",
  };
  const confirmation = toOrderConfirmation(poisoned);
  const serialized = JSON.stringify(confirmation);
  for (const secret of ["REAL-ORDER-UUID", "REAL-CUSTOMER-UUID", "REAL-ADDRESS-UUID", "REAL-SECRET-KEY", "REAL-FINGERPRINT-HASH", "should-not-leak"]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});
test("toPublicOrderItem never leaks the product's internal id/sku/slug/vatAmount even if the priced line carries them", () => {
  const poisonedLine = { product: { name: "Real Product", id: "PRODUCT-UUID", sku: "SKU-1", slug: "slug-1", vatRateBps: 2000 }, quantity: 2, lineTotal: 20_000, vatAmount: 4_000 };
  const item = toPublicOrderItem(poisonedLine, 10_000);
  assert.deepEqual(Object.keys(item).sort(), ["lineTotal", "productName", "quantity", "unitPrice"]);
  assert.equal(JSON.stringify(item).includes("PRODUCT-UUID"), false);
});
