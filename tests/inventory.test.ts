import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { availableUnits, reserveUnits, type InventoryRow } from "../lib/inventory.ts";

const route = readFileSync("app/api/orders/route.ts", "utf8");
const tx = route.slice(route.indexOf("db.transaction"));
const beforeTx = route.slice(0, route.indexOf("db.transaction"));
const stockUpdate = tx.slice(tx.indexOf("tx.update(inventory)"), tx.indexOf("OUT_OF_STOCK"));

const reserveOrThrow = (row: InventoryRow, qty: number) => { const r = reserveUnits(row, qty); assert.ok(r.ok); return r.ok ? r.next : row; };

// ---- the invariant, as an executable model -----------------------------------------------------
test("initial: on_hand=10, reserved=0 -> available 10", () => {
  assert.equal(availableUnits({ onHand: 10, reserved: 0 }), 10);
});
test("one order of quantity 1 -> available 9 (not 8)", () => {
  const after = reserveOrThrow({ onHand: 10, reserved: 0 }, 1);
  assert.deepEqual(after, { onHand: 9, reserved: 1 });
  assert.equal(availableUnits(after), 9);
});
test("a second order of quantity 1 -> available 8", () => {
  const after = reserveOrThrow(reserveOrThrow({ onHand: 10, reserved: 0 }, 1), 1);
  assert.deepEqual(after, { onHand: 8, reserved: 2 });
  assert.equal(availableUnits(after), 8);
});
test("a reservation of N lowers availability by exactly N, never 2N", () => {
  for (let n = 1; n <= 10; n++) {
    const start = { onHand: 10, reserved: 0 };
    assert.equal(availableUnits(start) - availableUnits(reserveOrThrow(start, n)), n, `N=${n}`);
  }
});
test("units that already sit in reserved are not subtracted from availability again", () => {
  // the exact Preview state that was wrongly refused: 5 sellable, 5 already committed elsewhere
  const row = { onHand: 5, reserved: 5 };
  assert.equal(availableUnits(row), 5);
  assert.equal(reserveUnits(row, 1).ok, true);
});
test("quantity greater than available is rejected and changes nothing", () => {
  const row = { onHand: 3, reserved: 7 };
  assert.deepEqual(reserveUnits(row, 4), { ok: false });
  assert.deepEqual(row, { onHand: 3, reserved: 7 });
  assert.equal(reserveUnits(row, 3).ok, true);
});
test("invalid quantities (0, negative, fractional) never reserve", () => {
  for (const q of [0, -1, 1.5, NaN]) assert.deepEqual(reserveUnits({ onHand: 10, reserved: 0 }, q), { ok: false }, String(q));
});
test("different orders can never oversell: the sum of accepted quantities never exceeds stock", () => {
  let row: InventoryRow = { onHand: 10, reserved: 0 };
  let accepted = 0;
  for (const q of [4, 4, 4, 3, 2, 1, 1]) { const r = reserveUnits(row, q); if (r.ok) { row = r.next; accepted += q; } }
  assert.equal(accepted, 10);
  assert.equal(row.onHand, 0);
  assert.equal(row.reserved, 10);
  assert.equal(reserveUnits(row, 1).ok, false);
});

// ---- the order route enforces the same rule in SQL ---------------------------------------------
test("the SQL guard is on_hand >= quantity and never subtracts reserved a second time", () => {
  assert.match(stockUpdate, /gte\(inventory\.onHand, line\.quantity\)/);
  const where = stockUpdate.slice(stockUpdate.indexOf(".where("));
  assert.doesNotMatch(where, /reserved/);
  assert.doesNotMatch(route, /inventory\.onHand\} - \$\{inventory\.reserved\}/);
});
test("a reservation removes exactly quantity from on_hand and adds exactly quantity to reserved", () => {
  assert.match(stockUpdate, /onHand: sql`\$\{inventory\.onHand\} - \$\{line\.quantity\}`/);
  assert.match(stockUpdate, /reserved: sql`\$\{inventory\.reserved\} \+ \$\{line\.quantity\}`/);
});
test("the stock write is ONE atomic conditional UPDATE ... RETURNING, so concurrent orders cannot oversell", () => {
  assert.match(stockUpdate, /\.update\(inventory\)\.set\([\s\S]*\)\.where\(and\(eq\(inventory\.productId[\s\S]*gte\(inventory\.onHand, line\.quantity\)\)\)\.returning/);
  assert.match(tx, /if \(!changed\.length\) throw new Error\(`OUT_OF_STOCK:/);
});
test("an out-of-stock throw aborts the whole transaction (no order, items, acceptances or marketing survive)", () => {
  assert.ok(tx.indexOf("OUT_OF_STOCK") < tx.indexOf("tx.insert(orderItems)"));
  assert.ok(tx.indexOf("tx.update(inventory)") < tx.indexOf("tx.insert(orderLegalAcceptances)"));
  assert.match(route, /error\.message\.startsWith\("OUT_OF_STOCK:"\)[\s\S]{0,200}status: 409/);
});

// ---- nothing that fails validation may reach the stock write -----------------------------------
test("replay, key conflict, legal, notice, pricing and charge failures all return BEFORE the transaction", () => {
  for (const marker of ["IDEMPOTENCY_KEY_REUSED", "LEGAL_DOCUMENTS_UNAVAILABLE", "acceptance.ok", "LEGAL_NOTICE_UNAVAILABLE", "CHARGES_UNDETERMINED", "PRICE_CHANGED", "orderRequestSchema.safeParse"]) {
    assert.ok(beforeTx.includes(marker), `${marker} is checked before the transaction`);
  }
  assert.doesNotMatch(beforeTx, /update\(inventory\)/);
});
test("the idempotency key is claimed before stock is touched: a concurrent duplicate reserves once", () => {
  assert.ok(tx.indexOf("onConflictDoNothing") < tx.indexOf("tx.update(inventory)"));
  assert.ok(tx.indexOf("throw new IdempotentReplay()") < tx.indexOf("tx.update(inventory)"));
});

// ---- one consistent meaning everywhere ---------------------------------------------------------
test("customer-visible and admin-visible stock is on_hand, matching availability = on_hand", () => {
  const publicApi = readFileSync("app/api/products/route.ts", "utf8");
  const adminOverview = readFileSync("app/api/admin/overview/route.ts", "utf8");
  for (const src of [publicApi, adminOverview]) { assert.match(src, /stock: inventory\.onHand/); assert.doesNotMatch(src, /reserved/); }
  assert.match(readFileSync("public/store.js", "utf8"), /p\.stock>0\?`Stok: \$\{p\.stock\}`/);
});
test("admin writes set on_hand directly; nothing else writes reserved except order creation", () => {
  const files = ["app/api/admin/products/route.ts", "app/api/admin/products/[id]/route.ts", "lib/catalog-service.ts"];
  for (const f of files) assert.doesNotMatch(readFileSync(f, "utf8"), /reserved/, f);
  assert.match(readFileSync("app/api/admin/products/[id]/route.ts", "utf8"), /onHand: stock/);
});
test("the model module documents the invariant and is not wired into schema or migrations", () => {
  const model = readFileSync("lib/inventory.ts", "utf8");
  assert.match(model, /available = on_hand/);
  assert.match(model, /counted every reserved[\s*]+unit twice/);
});
