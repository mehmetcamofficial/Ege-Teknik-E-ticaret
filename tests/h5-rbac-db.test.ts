import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { and, eq, sql } from "drizzle-orm";
import { adminUsers, auditLogs, inventory, orderItems, orders, payments, products, refunds } from "../db/schema.ts";
import { recordManualPayment, recordRefund, type FinanceDb } from "../lib/finance-db.ts";
import type { OrderStatus } from "../lib/order-domain.ts";
import { transitionOrder } from "../lib/order-transition.ts";
import { orderTransitionDeps } from "../lib/order-transition-db.ts";

/**
 * H5-B: the money-authority rules on REAL PostgreSQL (opt-in like tests/finance-db.test.ts: FINANCE_TEST_DATABASE_URL must be a
 * DISPOSABLE database migrated to head). Every negative case also asserts that NOTHING was written.
 */
const url = process.env.FINANCE_TEST_DATABASE_URL;
const skip = !url && "FINANCE_TEST_DATABASE_URL not set (disposable migrated database required)";
let pool: pg.Pool;
let db: FinanceDb;
const run = crypto.randomUUID().slice(0, 8);
const productId = `h5-prod-${run}`;
const mk = (id: string, permissions: string[]) => ({ userId: id, email: `${id}@example.test`, permissions });
const staff = mk(`h5-staff-${run}`, ["orders:write"]);                       // admin / operations_manager / support_agent
const finance = mk(`h5-fin-${run}`, ["payments:record", "payments:refund"]);  // finance_manager
const superAdmin = mk(`h5-super-${run}`, ["orders:write", "payments:record", "payments:refund"]);
let keySeq = 0;
const key = () => `h5-${run}-${++keySeq}`;
let orderSeq = 0;
async function makeOrder(total = 1000) {
  const n = ++orderSeq, id = `h5-order-${run}-${n}`, vat = Math.round(total * 2000 / 12000);
  await db.insert(orders).values({ id, orderNumber: `H5-${run}-${n}`, idempotencyKey: `h5-order-key-${run}-${n}`, customerName: "Müşteri", phone: "05000000000", city: "Aydın", address: "Test adresi 1", subtotal: total - vat, vatTotal: vat, total, status: "pending_payment", paymentStatus: "pending" });
  await db.insert(orderItems).values({ id: `h5-item-${run}-${n}`, orderId: id, productId, productName: "Test klima", unitPrice: total, vatRateBps: 2000, vatAmount: vat, quantity: 1, lineTotal: total });
  return id;
}
const snapshot = async (orderId: string) => ({
  order: (await db.select({ s: orders.status, p: orders.paymentStatus }).from(orders).where(eq(orders.id, orderId)))[0],
  payments: (await db.select().from(payments).where(eq(payments.orderId, orderId))).length,
  refunds: (await db.select().from(refunds).where(eq(refunds.orderId, orderId))).length,
  audits: (await db.select().from(auditLogs).where(eq(auditLogs.entityId, orderId))).length,
});
const change = async (orderId: string, to: OrderStatus, actor: { userId: string; email: string; permissions: readonly string[] }) => {
  const [cur] = await db.select({ s: orders.status }).from(orders).where(eq(orders.id, orderId));
  return transitionOrder({ orderId, expectedStatus: cur!.s as OrderStatus, nextStatus: to, actor }, orderTransitionDeps(db as never));
};
const pay = (orderId: string, amount: number, actor = finance, idempotencyKey = key()) => recordManualPayment(db, { orderId, body: { amount, method: "cash", reference: "", note: "" }, actor, idempotencyKey });

before(async () => {
  if (skip) return;
  pool = new pg.Pool({ connectionString: url });
  db = drizzle(pool) as FinanceDb;
  for (const a of [staff, finance, superAdmin]) await db.insert(adminUsers).values({ id: a.userId, externalUserId: `ext-${a.userId}`, email: a.email, role: "viewer" });
  await db.insert(products).values({ id: productId, slug: productId, name: "Test klima", price: 1000, status: "published", saleMode: "online" });
  await db.insert(inventory).values({ id: `h5-inv-${run}`, productId, onHand: 50, reserved: 5 });
});
after(async () => { if (pool) await pool.end(); });

test("ordinary staff cannot record a payment: refused with FORBIDDEN, nothing written", { skip }, async () => {
  const id = await makeOrder(), before = await snapshot(id);
  const r = await pay(id, 1000, staff);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.refusal.code, "FORBIDDEN");
  assert.equal(!r.ok && r.refusal.status, 403);
  assert.deepEqual(await snapshot(id), before);
});

test("ordinary staff cannot record a refund", { skip }, async () => {
  const id = await makeOrder();
  const paid = await pay(id, 1000);
  assert.ok(paid.ok);
  const before = await snapshot(id);
  const r = await recordRefund(db, { orderId: id, body: { paymentId: paid.ok ? paid.paymentId : "", amount: 100, reason: "test gerekçe" }, actor: staff, idempotencyKey: key() });
  assert.equal(!r.ok && r.refusal.code, "FORBIDDEN");
  assert.deepEqual(await snapshot(id), before);
});

test("nobody can mark an order paid without a ledger entry covering the total - not even a super admin", { skip }, async () => {
  const id = await makeOrder(), before = await snapshot(id);
  for (const actor of [superAdmin, finance]) {
    const r = await change(id, "paid", actor);
    assert.deepEqual(r.ok ? null : r.code, "PAYMENT_NOT_RECORDED");
  }
  assert.deepEqual(await snapshot(id), before);
  assert.ok((await pay(id, 400)).ok);
  assert.equal((await change(id, "paid", finance)).ok, false, "a partial payment still does not cover the total");
});

test("staff without payments:record cannot set 'paid' even when the ledger covers the total; finance can, once", { skip }, async () => {
  const id = await makeOrder();
  assert.ok((await pay(id, 1000)).ok);
  const before = await snapshot(id);
  const denied = await change(id, "paid", staff);
  assert.deepEqual(denied.ok ? null : denied.code, "FORBIDDEN");
  assert.deepEqual(await snapshot(id), before);
  assert.equal((await change(id, "paid", finance)).ok, true);
  const again = await change(id, "paid", finance);
  assert.deepEqual(again.ok ? null : again.code, "INVALID_TRANSITION", "repeating the transition is refused, not applied twice");
});

test("finance cannot change fulfilment states; staff can, but only fulfilment", { skip }, async () => {
  const id = await makeOrder();
  assert.ok((await pay(id, 1000)).ok);
  assert.equal((await change(id, "paid", finance)).ok, true);
  const denied = await change(id, "preparing", finance);
  assert.deepEqual(denied.ok ? null : denied.code, "FORBIDDEN");
  assert.equal((await change(id, "preparing", staff)).ok, true);
  assert.equal((await snapshot(id)).order.s, "preparing");
});

test("a repeated payment request with the same Idempotency-Key records one payment", { skip }, async () => {
  const id = await makeOrder(), k = key();
  const a = await pay(id, 500, finance, k), b = await pay(id, 500, finance, k);
  assert.ok(a.ok && b.ok && b.replayed);
  assert.equal((await snapshot(id)).payments, 1);
  const different = await pay(id, 600, finance, k);
  assert.equal(!different.ok && different.refusal.code, "IDEMPOTENCY_KEY_REUSED");
});

test("concurrent payments cannot over-collect and concurrent status changes apply once", { skip }, async () => {
  const id = await makeOrder(1000);
  const results = await Promise.all([0, 1, 2, 3, 4].map(() => pay(id, 400)));
  const accepted = results.filter((r) => r.ok).length;
  assert.equal(accepted, 2, "400 + 400 fits, a third 400 would exceed 1000");
  const [{ n }] = await db.select({ n: sql<number>`coalesce(sum(${payments.amount}),0)::int` }).from(payments).where(and(eq(payments.orderId, id), eq(payments.status, "paid")));
  assert.equal(Number(n), 800);
  assert.ok((await pay(id, 200)).ok);
  const racers = await Promise.all([finance, finance, finance].map(async (a) => {
    const [cur] = await db.select({ s: orders.status }).from(orders).where(eq(orders.id, id));
    return transitionOrder({ orderId: id, expectedStatus: cur!.s as OrderStatus, nextStatus: "paid", actor: a }, orderTransitionDeps(db as never));
  }));
  assert.equal(racers.filter((r) => r.ok).length, 1, "exactly one concurrent transition wins");
});

test("no sensitive action exists without its audit row: a forced audit failure rolls the payment back", { skip }, async () => {
  const id = await makeOrder(), before = await snapshot(id);
  await db.execute(sql`CREATE OR REPLACE FUNCTION h5_block_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit blocked'; END $$`);
  assert.match(id, /^[\w-]+$/, "DDL cannot take bind parameters: the id is a generated, validated literal");
  await db.execute(sql.raw(`CREATE TRIGGER h5_block_audit_trg BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.entity_id = '${id}') EXECUTE FUNCTION h5_block_audit()`));
  try {
    await assert.rejects(pay(id, 1000), /audit blocked|Failed query/);
  } finally {
    await db.execute(sql`DROP TRIGGER IF EXISTS h5_block_audit_trg ON audit_logs`);
    await db.execute(sql`DROP FUNCTION IF EXISTS h5_block_audit()`);
  }
  assert.deepEqual(await snapshot(id), before, "no payment row and no status change survived the failed audit");
});

test("successful money actions are audited with identity, amount and result; denials never write money rows", { skip }, async () => {
  const id = await makeOrder();
  assert.ok((await pay(id, 1000)).ok);
  assert.equal((await change(id, "paid", finance)).ok, true);
  const trail = await db.select().from(auditLogs).where(eq(auditLogs.entityId, id));
  const recorded = trail.find((a) => a.action === "payment_recorded");
  assert.equal(recorded?.actorUserId, finance.userId);
  assert.equal(recorded?.actorEmail, finance.email);
  assert.match(JSON.stringify(recorded?.payload), /1000/);
  const status = trail.find((a) => a.action === "status");
  assert.equal(status?.actorUserId, finance.userId);
  assert.match(JSON.stringify(status?.payload), /pending_payment/);
  assert.match(JSON.stringify(status?.payload), /paid/);
});

test("migration 0023 only widens CHECK lists: it touches no user, grant or invitation row", { skip }, async () => {
  const rows = await db.execute(sql`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname IN ('admin_users_role_ck','admin_invites_role_ck','admin_grants_permission_ck')`);
  const defs = Object.fromEntries((rows.rows as { conname: string; def: string }[]).map((r) => [r.conname, r.def]));
  assert.match(defs.admin_users_role_ck, /finance_manager/);
  assert.match(defs.admin_invites_role_ck, /finance_manager/);
  assert.match(defs.admin_grants_permission_ck, /payments:record/);
  assert.match(defs.admin_grants_permission_ck, /payments:refund/);
  await assert.rejects(db.insert(adminUsers).values({ id: `h5-bad-${run}`, externalUserId: `ext-bad-${run}`, email: `bad-${run}@example.test`, role: "payments_god" }), /violates check constraint|Failed query/);
});
