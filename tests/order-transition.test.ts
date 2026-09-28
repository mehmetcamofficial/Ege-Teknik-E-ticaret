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
  audits: { from: OrderStatus; to: OrderStatus }[];
  shipments: string[];
  installations: number;
};

function store(initial: Partial<State> = {}, failAudit = false) {
  const state: State = { status: "pending_payment", onHand: 9, reserved: 1, items: [{ productId: "p1", quantity: 1 }], audits: [], shipments: [], installations: 0, ...initial };
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
            lockOrder: async (id) => id === "order-1" ? { status: state.status } : null,
            listItems: async () => structuredClone(state.items),
            compareAndSetStatus: async (_id, expected, next) => {
              if (state.status !== expected) return false;
              state.status = next;
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
            insertAudit: async ({ from, to }) => {
              if (failAudit) throw new Error("audit unavailable");
              state.audits.push({ from, to });
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
  assert.deepEqual(await transitionOrder({ orderId: "order-1", expectedStatus: "pending_payment", nextStatus: "cancelled", actor }, db.deps), { ok: true });
  assert.deepEqual({ status: db.state.status, onHand: db.state.onHand, reserved: db.state.reserved }, { status: "cancelled", onHand: 10, reserved: 0 });
  assert.equal(db.state.audits.length, 1);
  const retry = await transitionOrder({ orderId: "order-1", expectedStatus: "pending_payment", nextStatus: "cancelled", actor }, db.deps);
  assert.equal(retry.ok, false);
  assert.deepEqual({ onHand: db.state.onHand, reserved: db.state.reserved, audits: db.state.audits.length }, { onHand: 10, reserved: 0, audits: 1 });
});

test("TD-15: valid transition succeeds; invalid and stale transitions perform no mutation", async () => {
  const valid = store();
  assert.deepEqual(await transitionOrder({ orderId: "order-1", expectedStatus: "pending_payment", nextStatus: "paid", actor }, valid.deps), { ok: true });
  assert.equal(valid.state.status, "paid");
  assert.deepEqual(valid.state.audits, [{ from: "pending_payment", to: "paid" }]);

  const invalid = store();
  assert.equal((await transitionOrder({ orderId: "order-1", expectedStatus: "pending_payment", nextStatus: "completed", actor }, invalid.deps)).ok, false);
  assert.equal(invalid.state.status, "pending_payment");
  assert.deepEqual(invalid.state.audits, []);

  const stale = store({ status: "paid" });
  assert.deepEqual(await transitionOrder({ orderId: "order-1", expectedStatus: "pending_payment", nextStatus: "cancelled", actor }, stale.deps), { ok: false, code: "STALE", actual: "paid" });
  assert.equal(stale.state.reserved, 1);
});

test("two simultaneous conflicting transitions from the same state produce exactly one winner", async () => {
  const db = store();
  const results = await Promise.all([
    transitionOrder({ orderId: "order-1", expectedStatus: "pending_payment", nextStatus: "paid", actor }, db.deps),
    transitionOrder({ orderId: "order-1", expectedStatus: "pending_payment", nextStatus: "cancelled", actor }, db.deps),
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
  const route = readFileSync("app/api/admin/orders/[id]/route.ts", "utf8");
  const transaction = route.slice(route.indexOf("transaction:(work)"));
  assert.match(transaction, /\.for\("update"\)/);
  assert.match(transaction, /eq\(orders\.status,expected\)/);
  assert.match(transaction, /gte\(inventory\.reserved,quantity\)/);
  assert.match(transaction, /onHand:sql`\$\{inventory\.onHand\}\+\$\{quantity\}`/);
  assert.match(transaction, /reserved:sql`\$\{inventory\.reserved\}-\$\{quantity\}`/);
  assert.match(transaction, /tx\.insert\(auditLogs\)/);
  assert.doesNotMatch(transaction, /db\.insert\(auditLogs\)/);
});
