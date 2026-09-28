import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transitionOrder, type OrderTransitionTx } from "../lib/order-transition.ts";
import type { OrderStatus } from "../lib/order-domain.ts";

const actor = { userId: "admin-1", email: "admin@example.test" };
type State = {
  status: OrderStatus;
  onHand: number;
  reserved: number;
  items: { productId: string | null; quantity: number }[];
  audits: { from: OrderStatus; to: OrderStatus; paymentStatus?: { from: string; to: string }; stockReleased?: { productId: string | null; quantity: number }[] }[];
  shipments: string[];
  installations: number;
  // Finance ledger (Phase 3.3A): what the payments/refunds tables hold for the order, and the cached payment_status.
  total: number;
  collected: number;
  refunded: number;
  paymentStatus: string;
};

function store(initial: Partial<State> = {}, failAudit = false) {
  const state: State = { status: "pending_payment", onHand: 9, reserved: 1, items: [{ productId: "p1", quantity: 1 }], audits: [], shipments: [], installations: 0, total: 1000, collected: 0, refunded: 0, paymentStatus: "pending", ...initial };
  let tail = Promise.resolve();
  return {
    state,
    deps: {
      transaction: async <T>(work: (tx: OrderTransitionTx) => Promise<T>) => {
        const previous = tail;
        let release!: () => void;
        tail = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        const snapshot = structuredClone(state);
        try {
          return await work({
            lockOrder: async (id) => id === "order-1" ? { status: state.status, total: state.total, paymentStatus: state.paymentStatus } : null,
            ledgerSums: async () => ({ collected: state.collected, refunded: state.refunded }),
            listItems: async () => structuredClone(state.items),
            compareAndSetStatus: async (_id, expected, next, paymentStatus) => {
              if (state.status !== expected) return false;
              state.status = next;
              state.paymentStatus = paymentStatus;
              return true;
            },
            releaseInventory: async (_productId, quantity) => {
              if (state.reserved < quantity) return false;
              state.onHand += quantity;
              state.reserved -= quantity;
              return true;
            },
            createShipment: async (_id, status) => { state.shipments.push(status); },
            createInstallationJob: async () => { state.installations += 1; },
            insertAudit: async ({ from, to, paymentStatus, stockReleased }) => {
              if (failAudit) throw new Error("audit unavailable");
              state.audits.push({ from, to, paymentStatus, ...(stockReleased ? { stockReleased } : {}) });
            },
          });
        } catch (error) {
          Object.assign(state, snapshot);
          throw error;
        } finally {
          release();
        }
      },
    },
  };
}

test("TD-14: cancelling once restores onHand and reserved exactly once; retry is stale and idempotent", async () => {
  const db = store();
  assert.deepEqual(await transitionOrder({ orderId: "order-1", expectedStatus: "pending_payment", nextStatus: "cancelled", actor }, db.deps), { ok: true, paymentStatus: "cancelled" });
  assert.deepEqual({ status: db.state.status, onHand: db.state.onHand, reserved: db.state.reserved }, { status: "cancelled", onHand: 10, reserved: 0 });
  assert.equal(db.state.audits.length, 1);
  const retry = await transitionOrder({ orderId: "order-1", expectedStatus: "pending_payment", nextStatus: "cancelled", actor }, db.deps);
  assert.equal(retry.ok, false);
  assert.deepEqual({ onHand: db.state.onHand, reserved: db.state.reserved, audits: db.state.audits.length }, { onHand: 10, reserved: 0, audits: 1 });
});

test("TD-15: valid transition succeeds; invalid and stale transitions perform no mutation", async () => {
  const valid = store({ collected: 1000 }); // `paid` needs the ledger to hold the full total (finance guard)
  assert.deepEqual(await transitionOrder({ orderId: "order-1", expectedStatus: "pending_payment", nextStatus: "paid", actor }, valid.deps), { ok: true, paymentStatus: "paid" });
  assert.equal(valid.state.status, "paid");
  assert.deepEqual(valid.state.audits, [{ from: "pending_payment", to: "paid", paymentStatus: { from: "pending", to: "paid" } }]);

  const invalid = store();
  assert.equal((await transitionOrder({ orderId: "order-1", expectedStatus: "pending_payment", nextStatus: "completed", actor }, invalid.deps)).ok, false);
  assert.equal(invalid.state.status, "pending_payment");
  assert.deepEqual(invalid.state.audits, []);

  const stale = store({ status: "paid" });
  assert.deepEqual(await transitionOrder({ orderId: "order-1", expectedStatus: "pending_payment", nextStatus: "cancelled", actor }, stale.deps), { ok: false, code: "STALE", actual: "paid" });
  assert.equal(stale.state.reserved, 1);
});

test("two simultaneous conflicting transitions from the same state produce exactly one winner", async () => {
  const db = store({ status: "paid" }); // a paid order with nothing collected on record (legacy row): both moves pass the finance guards
  const results = await Promise.all([
    transitionOrder({ orderId: "order-1", expectedStatus: "paid", nextStatus: "preparing", actor }, db.deps),
    transitionOrder({ orderId: "order-1", expectedStatus: "paid", nextStatus: "cancelled", actor }, db.deps),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok && result.code === "STALE").length, 1);
  assert.equal(db.state.audits.length, 1);
  assert.ok(db.state.onHand >= 0 && db.state.reserved >= 0);
  if (db.state.status === "cancelled") assert.deepEqual([db.state.onHand, db.state.reserved], [10, 0]);
  else assert.deepEqual([db.state.onHand, db.state.reserved], [9, 1]);
});

test("non-cancellable fulfilment state leaves inventory unchanged", async () => {
  const db = store({ status: "shipped" });
  const result = await transitionOrder({ orderId: "order-1", expectedStatus: "shipped", nextStatus: "cancelled", actor }, db.deps);
  assert.equal(result.ok, false);
  assert.deepEqual([db.state.onHand, db.state.reserved, db.state.audits.length], [9, 1, 0]);
});

test("inventory mismatch and audit failure roll back status, stock, side effects and audit", async () => {
  const mismatch = store({ reserved: 0 });
  assert.deepEqual(await transitionOrder({ orderId: "order-1", expectedStatus: "pending_payment", nextStatus: "cancelled", actor }, mismatch.deps), { ok: false, code: "INVENTORY_INVARIANT" });
  assert.deepEqual([mismatch.state.status, mismatch.state.onHand, mismatch.state.reserved, mismatch.state.audits.length], ["pending_payment", 9, 0, 0]);

  const auditFailure = store({}, true);
  await assert.rejects(() => transitionOrder({ orderId: "order-1", expectedStatus: "pending_payment", nextStatus: "cancelled", actor }, auditFailure.deps), /audit unavailable/);
  assert.deepEqual([auditFailure.state.status, auditFailure.state.onHand, auditFailure.state.reserved, auditFailure.state.audits.length], ["pending_payment", 9, 1, 0]);
});

test("route holds row lock, CAS, stock release and audit inside the same transaction", () => {
  const route = readFileSync("lib/order-transition-db.ts", "utf8");
  const transaction = route.slice(route.indexOf("transaction:"));
  assert.match(transaction, /\.for\("update"\)/);
  assert.match(transaction, /eq\(orders\.status,expected\)/);
  assert.match(transaction, /gte\(inventory\.reserved,quantity\)/);
  assert.match(transaction, /onHand:sql`\$\{inventory\.onHand\}\+\$\{quantity\}`/);
  assert.match(transaction, /reserved:sql`\$\{inventory\.reserved\}-\$\{quantity\}`/);
  assert.match(transaction, /tx\.insert\(auditLogs\)/);
  assert.doesNotMatch(transaction, /db\.insert\(auditLogs\)/);
});

// ---- Finance guards merged into the Sprint B transition (Phase 3.3A + Sprint B) ---------------------------------
const paidStatus = (db: ReturnType<typeof store>, expectedStatus: OrderStatus, nextStatus: OrderStatus) =>
  transitionOrder({ orderId: "order-1", expectedStatus, nextStatus, actor }, db.deps);

test("finance: `paid` is refused unless the ledger holds the full total; nothing is written on refusal", async () => {
  for (const collected of [0, 400, 999]) {
    const db = store({ collected });
    assert.deepEqual(await paidStatus(db, "pending_payment", "paid"), { ok: false, code: "PAYMENT_NOT_RECORDED", actual: "pending_payment" });
    assert.deepEqual([db.state.status, db.state.paymentStatus, db.state.audits.length, db.state.onHand, db.state.reserved], ["pending_payment", "pending", 0, 9, 1]);
  }
  const covered = store({ collected: 1000 });
  assert.deepEqual(await paidStatus(covered, "pending_payment", "paid"), { ok: true, paymentStatus: "paid" });
  const refundedBack = store({ collected: 1000, refunded: 1000 });
  assert.equal((await paidStatus(refundedBack, "pending_payment", "paid")).ok, false, "money that was refunded no longer covers the order");
});

test("finance: cancelling while money is held is refused (refund first) and moves neither status nor stock", async () => {
  const db = store({ collected: 1000 });
  assert.deepEqual(await paidStatus(db, "pending_payment", "cancelled"), { ok: false, code: "REFUND_REQUIRED", actual: "pending_payment" });
  assert.deepEqual([db.state.status, db.state.onHand, db.state.reserved, db.state.audits.length], ["pending_payment", 9, 1, 0]);
  const both = store({ collected: 500 });
  const results = await Promise.all([paidStatus(both, "pending_payment", "cancelled"), paidStatus(both, "pending_payment", "cancelled")]);
  assert.ok(results.every((r) => !r.ok && r.code === "REFUND_REQUIRED"));
  assert.deepEqual([both.state.onHand, both.state.reserved], [9, 1], "concurrent refused cancels release nothing");
});

test("finance: after the refund is recorded, cancellation succeeds, releases stock once and derives the payment status from the ledger", async () => {
  const db = store({ status: "paid", paymentStatus: "paid", collected: 1000, refunded: 1000 });
  assert.deepEqual(await paidStatus(db, "paid", "cancelled"), { ok: true, paymentStatus: "refunded" });
  assert.deepEqual([db.state.status, db.state.paymentStatus, db.state.onHand, db.state.reserved], ["cancelled", "refunded", 10, 0]);
  assert.deepEqual(db.state.audits, [{ from: "paid", to: "cancelled", paymentStatus: { from: "paid", to: "refunded" }, stockReleased: [{ productId: "p1", quantity: 1 }] }]);
  const retry = await paidStatus(db, "paid", "cancelled");
  assert.equal(retry.ok, false);
  assert.deepEqual([db.state.onHand, db.state.reserved, db.state.audits.length], [10, 0, 1], "a retry moves no stock and writes no second audit");
});

test("finance: payment_status is derived, never taken from the caller (the request type has no such field)", async () => {
  const unpaid = store();
  assert.deepEqual(await paidStatus(unpaid, "pending_payment", "cancelled"), { ok: true, paymentStatus: "cancelled" });
  const src = readFileSync("app/api/admin/orders/[id]/route.ts", "utf8");
  assert.doesNotMatch(src, /paymentStatus:\s*parsed|parsed\.data\.paymentStatus/);
  assert.match(readFileSync("lib/order-transition-db.ts", "utf8"), /set\(\{status:next,paymentStatus,updatedAt/);
});
