import assert from "node:assert/strict";
import test from "node:test";
import { computeOrderTotals, orderRequestSchema, priceOrderLines } from "../lib/order-domain.ts";

const baseRequest = {
  customerName: "Ada Lovelace",
  phone: "05001112233",
  email: "ada@example.test",
  city: "İzmir",
  address: "Kuşadası Mahallesi 1 Sokak No 1",
  paymentProvider: "PayTR" as const,
  items: [{ productId: "p1", quantity: 2 }],
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
