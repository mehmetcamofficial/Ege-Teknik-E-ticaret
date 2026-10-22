import assert from "node:assert/strict";
import test from "node:test";
import { calculateLine, canTransitionOrder } from "../lib/order-domain.ts";
test("order lifecycle permits only explicit transitions", () => { assert.equal(canTransitionOrder("pending_payment", "paid"), true); assert.equal(canTransitionOrder("pending_payment", "completed"), false); assert.equal(canTransitionOrder("completed", "preparing"), false); });
test("order line snapshots calculate VAT inside tax-inclusive price", () => { assert.deepEqual(calculateLine(12_000, 2, 2_000), { lineTotal: 24_000, vatAmount: 4_000 }); });
