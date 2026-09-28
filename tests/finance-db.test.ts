import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq } from "drizzle-orm";
import { adminUsers, auditLogs, inventory, orderItems, orders, payments, products } from "../db/schema.ts";
import { changeOrderStatus, loadFinanceReport, loadOrderLedger, recordManualPayment, recordRefund, type FinanceDb } from "../lib/finance-db.ts";

/**
 * Real-PostgreSQL checks of the finance SQL (row locks, sums, CTE, CHECKs). Opt-in: set FINANCE_TEST_DATABASE_URL to
 * a DISPOSABLE database already migrated to head (drizzle-pg). Never point it at Preview or Production. Every run
 * uses fresh ids and its own far-past date window, so rows from other runs never enter an assertion.
 */
const url = process.env.FINANCE_TEST_DATABASE_URL;
const skip = !url && "FINANCE_TEST_DATABASE_URL not set (disposable migrated database required)";

let pool: pg.Pool;
let db: FinanceDb;
const run = crypto.randomUUID().slice(0, 8);
const year = 2001 + Math.floor(Math.random() * 20);
const windowStart = new Date(Date.UTC(year, Math.floor(Math.random() * 12), 1, 0, 0, 0));
const windowEnd = new Date(windowStart.getTime() + 20 * 24 * 60 * 60 * 1000);
const at = (day: number) => new Date(windowStart.getTime() + day * 24 * 60 * 60 * 1000 + 3_600_000);
const actor = { userId: `fin-admin-${run}`, email: `fin-${run}@example.test` };
const productId = `fin-prod-${run}`;
let keySeq = 0;
const key = () => `fin-${run}-${++keySeq}`;

async function makeOrder(n: number, total: number, opts: { status?: string; paymentStatus?: string; quantity?: number } = {}) {
  const id = `fin-order-${run}-${n}`;
  const vat = Math.round(total * 2000 / 12000);
  await db.insert(orders).values({ id, orderNumber: `FIN-${run}-${n}`, idempotencyKey: `fin-order-key-${run}-${n}`, customerName: `Müşteri ${n}`, phone: "05000000000", city: "Aydın", address: "Test adresi 1", subtotal: total - vat, vatTotal: vat, total, status: opts.status ?? "pending_payment", paymentStatus: opts.paymentStatus ?? "pending", createdAt: at(n), updatedAt: at(n) });
  await db.insert(orderItems).values({ id: `fin-item-${run}-${n}`, orderId: id, productId, productName: "Test klima", unitPrice: total, vatRateBps: 2000, vatAmount: vat, quantity: opts.quantity ?? 1, lineTotal: total });
  return id;
}

before(async () => {
  if (skip) return;
  pool = new pg.Pool({ connectionString: url });
  db = drizzle(pool) as FinanceDb;
  await db.insert(adminUsers).values({ id: actor.userId, externalUserId: `ext-${run}`, email: actor.email, role: "operations_manager" });
  await db.insert(products).values({ id: productId, slug: productId, name: "Test klima", price: 1000, status: "published", saleMode: "online" });
  await db.insert(inventory).values({ id: `fin-inv-${run}`, productId, onHand: 5, reserved: 2 });
});
after(async () => { if (pool) await pool.end(); });

test("a manual payment is recorded, derives partially_paid then paid, and is audited", { skip }, async () => {
  const id = await makeOrder(1, 1000);
  const first = await recordManualPayment(db, { orderId: id, body: { amount: 400, method: "cash", reference: "", note: "" }, actor, idempotencyKey: key(), now: at(1) });
  assert.equal(first.ok, true);
  assert.equal(first.ok && first.paymentStatus, "partially_paid");
  const second = await recordManualPayment(db, { orderId: id, body: { amount: 600, method: "bank_transfer", reference: "DEKONT-1", note: "" }, actor, idempotencyKey: key(), now: at(1) });
  assert.equal(second.ok && second.paymentStatus, "paid");
  const ledger = await loadOrderLedger(db, id);
  assert.equal(ledger?.collected, 1000);
  assert.equal(ledger?.outstanding, 0);
  const trail = await db.select().from(auditLogs).where(eq(auditLogs.entityId, id));
  assert.equal(trail.filter((a) => a.action === "payment_recorded").length, 2);
});

test("overpayment is refused: collected can never exceed the order total", { skip }, async () => {
  const id = await makeOrder(2, 1000);
  const r = await recordManualPayment(db, { orderId: id, body: { amount: 1001, method: "cash", reference: "", note: "" }, actor, idempotencyKey: key(), now: at(2) });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.refusal.code, "OVERPAYMENT");
});

test("the same Idempotency-Key replays the payment once; reused for a different body it is refused", { skip }, async () => {
  const id = await makeOrder(3, 1000);
  const k = key();
  const body = { amount: 300, method: "pos" as const, reference: "SLIP-9", note: "" };
  const a = await recordManualPayment(db, { orderId: id, body, actor, idempotencyKey: k, now: at(3) });
  const b = await recordManualPayment(db, { orderId: id, body, actor, idempotencyKey: k, now: at(3) });
  assert.equal(a.ok && b.ok && a.paymentId === b.paymentId && b.replayed, true);
  const c = await recordManualPayment(db, { orderId: id, body: { ...body, amount: 301 }, actor, idempotencyKey: k, now: at(3) });
  assert.equal(!c.ok && c.refusal.code, "IDEMPOTENCY_KEY_REUSED");
  assert.equal((await db.select().from(payments).where(eq(payments.orderId, id))).length, 1);
});

test("concurrent payments on one order are serialized by the row lock: the total is never exceeded", { skip }, async () => {
  const id = await makeOrder(4, 1000);
  const results = await Promise.all([0, 1, 2].map(() => recordManualPayment(db, { orderId: id, body: { amount: 600, method: "cash", reference: "", note: "" }, actor, idempotencyKey: key(), now: at(4) })));
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal((await loadOrderLedger(db, id))?.collected, 600);
});

test("partial refund, then full refund; refund above the payment and duplicate refund are refused", { skip }, async () => {
  const id = await makeOrder(5, 1000);
  const pay = await recordManualPayment(db, { orderId: id, body: { amount: 1000, method: "cash", reference: "", note: "" }, actor, idempotencyKey: key(), now: at(5) });
  assert.ok(pay.ok);
  const paymentId = pay.ok ? pay.paymentId : "";
  const tooMuch = await recordRefund(db, { orderId: id, body: { paymentId, amount: 1001, reason: "fazla iade" }, actor, idempotencyKey: key(), now: at(5) });
  assert.equal(!tooMuch.ok && tooMuch.refusal.code, "REFUND_EXCEEDS_PAYMENT");
  const k = key();
  const part = await recordRefund(db, { orderId: id, body: { paymentId, amount: 250, reason: "kısmi iade" }, actor, idempotencyKey: k, now: at(5) });
  assert.equal(part.ok && part.paymentStatus, "partially_refunded");
  const dup = await recordRefund(db, { orderId: id, body: { paymentId, amount: 250, reason: "kısmi iade" }, actor, idempotencyKey: k, now: at(5) });
  assert.equal(dup.ok && dup.replayed, true);
  const rest = await recordRefund(db, { orderId: id, body: { paymentId, amount: 750, reason: "kalan iade" }, actor, idempotencyKey: key(), now: at(5) });
  assert.equal(rest.ok && rest.paymentStatus, "refunded");
  assert.equal(rest.ok && rest.full, true);
  const again = await recordRefund(db, { orderId: id, body: { paymentId, amount: 1, reason: "tekrar iade" }, actor, idempotencyKey: key(), now: at(5) });
  assert.equal(!again.ok && again.refusal.code, "ALREADY_REFUNDED");
  const ledger = await loadOrderLedger(db, id);
  assert.equal(ledger?.refunded, 1000);
  assert.equal(ledger?.netCollected, 0);
  const trail = (await db.select().from(auditLogs).where(eq(auditLogs.entityId, id))).map((a) => a.action);
  assert.ok(trail.includes("refund_partial") && trail.includes("refund_full"));
});

test("'paid' order status needs a recorded payment; cancellation needs the money refunded and releases stock", { skip }, async () => {
  const id = await makeOrder(6, 1000, { quantity: 2 });
  const early = await changeOrderStatus(db, { orderId: id, to: "paid", actor, now: at(6) });
  assert.equal(!early.ok && early.refusal.code, "PAYMENT_NOT_RECORDED");
  const pay = await recordManualPayment(db, { orderId: id, body: { amount: 1000, method: "cash", reference: "", note: "" }, actor, idempotencyKey: key(), now: at(6) });
  assert.equal((await changeOrderStatus(db, { orderId: id, to: "paid", actor, now: at(6) })).ok, true);
  const blocked = await changeOrderStatus(db, { orderId: id, to: "cancelled", actor, now: at(6) });
  assert.equal(!blocked.ok && blocked.refusal.code, "REFUND_REQUIRED");
  await recordRefund(db, { orderId: id, body: { paymentId: pay.ok ? pay.paymentId : "", amount: 1000, reason: "iptal iadesi" }, actor, idempotencyKey: key(), now: at(6) });
  const [before] = await db.select().from(inventory).where(eq(inventory.productId, productId));
  const cancelled = await changeOrderStatus(db, { orderId: id, to: "cancelled", actor, now: at(6) });
  assert.equal(cancelled.ok && cancelled.paymentStatus, "refunded");
  const [afterRow] = await db.select().from(inventory).where(eq(inventory.productId, productId));
  assert.equal(afterRow!.onHand, before!.onHand + 2);
  assert.equal(afterRow!.reserved, Math.max(before!.reserved - 2, 0));
});

test("an unpaid cancelled order derives 'cancelled' and nothing is collected", { skip }, async () => {
  const id = await makeOrder(7, 500);
  const r = await changeOrderStatus(db, { orderId: id, to: "cancelled", actor, now: at(7) });
  assert.equal(r.ok && r.paymentStatus, "cancelled");
});

test("the report separates order value, collected, outstanding, cancelled, refunded and net - and flags unbacked 'paid'", { skip }, async () => {
  await makeOrder(8, 700, { status: "paid", paymentStatus: "paid" }); // legacy: flagged paid by dropdown, no payment row
  const report = await loadFinanceReport(db, { range: { start: windowStart, end: windowEnd }, filters: {}, page: 1 });
  const s = report.summary;
  // orders 1..8: totals 1000,1000,1000,1000,1000,1000(cancelled),500(cancelled),700
  assert.equal(s.orderCount, 8);
  assert.equal(s.cancelledCount, 2);
  assert.equal(s.orderValue, 1000 * 5 + 700);
  assert.equal(s.cancelledValue, 1500);
  assert.equal(s.collected, 1000 + 300 + 600 + 1000 + 1000);
  assert.equal(s.refunded, 2000);
  assert.equal(s.netCollected, s.collected - s.refunded);
  assert.equal(s.outstanding, 0 + 1000 + 700 + 400 + 0 + 700);
  assert.equal(s.unbackedPaidCount, 1);
  const legacy = report.rows.find((r) => r.orderNumber === `FIN-${run}-8`);
  assert.equal(legacy?.paymentStatus, "pending", "a dropdown 'paid' without a payment row is NOT paid");
  assert.equal(report.methods.reduce((sum, m) => sum + m.collected, 0), s.collected);
});

test("filters: payment status, order status, method and date window", { skip }, async () => {
  const range = { start: windowStart, end: windowEnd };
  const paid = await loadFinanceReport(db, { range, filters: { paymentStatus: "paid" }, page: 1 });
  assert.deepEqual(paid.rows.map((r) => r.orderNumber).sort(), [`FIN-${run}-1`]);
  const cancelled = await loadFinanceReport(db, { range, filters: { orderStatus: "cancelled" }, page: 1 });
  assert.equal(cancelled.summary.orderCount, 2);
  const pos = await loadFinanceReport(db, { range, filters: { method: "pos" }, page: 1 });
  assert.deepEqual(pos.rows.map((r) => r.orderNumber), [`FIN-${run}-3`]);
  assert.deepEqual(pos.methods.map((m) => m.method), ["pos"]);
  const empty = await loadFinanceReport(db, { range: { start: new Date(windowEnd.getTime() + 1), end: new Date(windowEnd.getTime() + 86_400_000) }, filters: {}, page: 1 });
  assert.equal(empty.summary.orderCount, 0);
  assert.equal(empty.summary.collected, 0);
  assert.deepEqual(empty.rows, []);
  const paged = await loadFinanceReport(db, { range, filters: {}, page: 2, pageSize: 3 });
  assert.equal(paged.pageCount, 3);
  assert.equal(paged.rows.length, 3);
});

test("DB CHECKs refuse a non-positive payment and a 'paid' payment without paid_at", { skip }, async () => {
  const id = await makeOrder(9, 100);
  await assert.rejects(db.insert(payments).values({ id: crypto.randomUUID(), orderId: id, provider: "manual", amount: 0, status: "pending" }));
  await assert.rejects(db.insert(payments).values({ id: crypto.randomUUID(), orderId: id, provider: "manual", amount: 10, status: "paid" }));
});
