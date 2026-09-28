import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import pg from "pg";
import { auditLogs, inventory, orderItems, orders, payments, products } from "../db/schema.ts";
import { loadFinanceReport, recordManualPayment, type FinanceDb } from "../lib/finance-db.ts";
import { paytrCallbackHash, readPaytrConfig, type PaytrCallback, type PaytrConfig } from "../lib/paytr.ts";
import { loadPaytrAttempt, processPaytrCallback, startPaytrPayment } from "../lib/paytr-db.ts";

/**
 * PayTR token + callback flows on a real PostgreSQL with a FAKE fetch: no credential, no network. Opt-in with
 * FINANCE_TEST_DATABASE_URL (a disposable database migrated to head), exactly like tests/finance-db.test.ts.
 */
const url = process.env.FINANCE_TEST_DATABASE_URL;
const skip = !url && "FINANCE_TEST_DATABASE_URL not set (disposable migrated database required)";
const env = { PAYTR_ENABLED: "true", PAYTR_MERCHANT_ID: "123456", PAYTR_MERCHANT_KEY: "TEST_KEY_not_real", PAYTR_MERCHANT_SALT: "TEST_SALT_not_real", PAYTR_OK_URL: "https://preview.example.test/payment/success", PAYTR_FAIL_URL: "https://preview.example.test/payment/fail" };
const enabled = readPaytrConfig(env);
const config = (enabled as { config: PaytrConfig }).config;

let pool: pg.Pool;
let db: FinanceDb;
const run = crypto.randomUUID().slice(0, 8).toUpperCase();
const base = new Date(Date.UTC(1900 + Math.floor(Math.random() * 90), Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 27)));
const at = (n: number) => new Date(base.getTime() + n * 86_400_000);
const productId = `ptr-prod-${run}`;
const admin = { userId: `ptr-admin-${run}`, email: `ptr-${run}@example.test` };
const calls: { url: string; body: URLSearchParams }[] = [];
let nextResponse: () => Promise<Response> = async () => Response.json({ status: "success", token: `TOK${run}${calls.length}` });
const fakeFetch = (async (u: string, init: RequestInit) => { calls.push({ url: u, body: new URLSearchParams(String(init.body)) }); return nextResponse(); }) as unknown as typeof fetch;

async function makeOrder(n: number, total: number) {
  const id = `ptr-order-${run}-${n}`, orderNumber = `ETS-P${run}-${n}`;
  await db.insert(orders).values({ id, orderNumber, idempotencyKey: `ptr-key-${run}-${n}`, customerName: "Test Müşteri", phone: "05000000000", email: `buyer${n}@example.test`, city: "Aydın", address: "Test adresi", subtotal: total - Math.round(total / 6), vatTotal: Math.round(total / 6), total, createdAt: at(n), updatedAt: at(n) });
  await db.insert(orderItems).values({ id: `ptr-item-${run}-${n}`, orderId: id, productId, productName: "Test klima", unitPrice: total, vatRateBps: 2000, vatAmount: Math.round(total / 6), quantity: 1, lineTotal: total });
  return { id, orderNumber, email: `buyer${n}@example.test` };
}
const start = (o: { orderNumber: string; email: string }, extra: Partial<Parameters<typeof startPaytrPayment>[1]> = {}) =>
  startPaytrPayment(db, { config: enabled, orderNumber: o.orderNumber, email: o.email, userIp: "203.0.113.7", fetchImpl: fakeFetch, now: at(40), ...extra });
function callback(merchantOid: string, status: "success" | "failed", kurus: string, extra: Partial<PaytrCallback> = {}): PaytrCallback {
  const cb = { merchantOid, status, totalAmount: kurus, paymentAmount: kurus, failedReasonCode: null, failedReasonMsg: null, paymentType: "card", testMode: "1", currency: "TL", ...extra };
  return { ...cb, hash: paytrCallbackHash({ merchantOid: cb.merchantOid, status: cb.status, totalAmount: cb.totalAmount }, config), ...(extra.hash ? { hash: extra.hash } : {}) };
}
const auditCount = async (orderId: string, action: string) => (await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, orderId), eq(auditLogs.action, action)))).length;
const attempts = (orderId: string) => db.select().from(payments).where(eq(payments.orderId, orderId));

before(async () => {
  if (skip) return;
  pool = new pg.Pool({ connectionString: url });
  db = drizzle(pool) as FinanceDb;
  await db.insert(products).values({ id: productId, slug: productId, name: "Test klima", price: 1000, status: "published", saleMode: "online" });
  await db.insert(inventory).values({ id: `ptr-inv-${run}`, productId, onHand: 7, reserved: 3 });
  await db.execute(`insert into admin_users (id, external_user_id, email, role) values ('${admin.userId}', 'ext-${admin.userId}', '${admin.email}', 'operations_manager')`);
});
after(async () => { if (pool) await pool.end(); });

test("flag off or misconfigured: refused before any database or provider work", { skip }, async () => {
  const o = await makeOrder(1, 1000);
  for (const cfg of [readPaytrConfig({}), readPaytrConfig({ PAYTR_ENABLED: "true" })]) {
    const r = await startPaytrPayment(db, { config: cfg, orderNumber: o.orderNumber, email: o.email, userIp: "1.1.1.1", fetchImpl: fakeFetch });
    assert.equal(!r.ok && r.status, 503);
  }
  assert.equal(calls.length, 0);
  assert.equal((await attempts(o.id)).length, 0);
});

test("wrong e-mail or unknown order: same refusal, nothing created", { skip }, async () => {
  const o = await makeOrder(2, 1000);
  for (const r of [await start({ ...o, email: "other@example.test" }), await start({ orderNumber: "ETS-NOPE-1", email: o.email })]) assert.equal(!r.ok && r.code, "ORDER_NOT_FOUND");
  assert.equal((await attempts(o.id)).length, 0);
});

test("token: amount is the DB outstanding balance in kuruş, a pending attempt + audit is created once, only the iframe token comes back", { skip }, async () => {
  const o = await makeOrder(3, 167000);
  const before = calls.length;
  const r = await start(o);
  assert.equal(r.ok, true);
  assert.equal(calls.length, before + 1);
  const sent = calls.at(-1)!.body;
  assert.equal(sent.get("payment_amount"), "16700000");
  assert.equal(sent.get("merchant_oid"), r.ok && r.merchantOid);
  assert.equal(sent.get("email"), o.email);
  assert.match(sent.get("merchant_ok_url")!, /\?ref=/);
  assert.equal(sent.has("merchant_key") || sent.has("merchant_salt"), false);
  assert.ok(!JSON.stringify([...sent]).includes(env.PAYTR_MERCHANT_KEY));
  const rows = await attempts(o.id);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0]!.provider, rows[0]!.status, rows[0]!.method, rows[0]!.amount], ["paytr", "pending", "online", 167000]);
  assert.equal(await auditCount(o.id, "paytr_payment_attempt_created"), 1);
  assert.match(r.ok ? r.iframeUrl : "", /^https:\/\/www\.paytr\.com\/odeme\/guvenli\/TOK/);
});

test("duplicate start while the token is live reuses the attempt: no second attempt, no second provider call", { skip }, async () => {
  const o = await makeOrder(4, 5000);
  const a = await start(o), n = calls.length;
  const b = await start(o);
  assert.equal(a.ok && b.ok && a.merchantOid === b.merchantOid && b.reused, true);
  assert.equal(calls.length, n);
  assert.equal((await attempts(o.id)).length, 1);
});

test("provider token failure: attempt marked failed, customer gets a friendly error, a retry creates a fresh attempt", { skip }, async () => {
  const o = await makeOrder(5, 5000);
  nextResponse = async () => Response.json({ status: "failed", reason: "raw provider reason <b>" });
  const r = await start(o);
  assert.equal(!r.ok && r.code, "PAYMENT_PROVIDER_ERROR");
  assert.doesNotMatch(!r.ok ? r.error : "", /raw provider reason/);
  nextResponse = async () => Response.json({ status: "success", token: `TOK${run}retry` });
  const retry = await start(o);
  assert.equal(retry.ok, true);
  const rows = await attempts(o.id);
  assert.deepEqual(rows.map((p) => p.status).sort(), ["failed", "pending"]);
});

test("valid success callback: paid once, order advanced, audited once; duplicate callbacks change nothing", { skip }, async () => {
  const o = await makeOrder(6, 20000);
  const r = await start(o);
  assert.ok(r.ok);
  const oid = r.ok ? r.merchantOid : "";
  const [inv0] = await db.select().from(inventory).where(eq(inventory.productId, productId));
  const first = await processPaytrCallback(db, { config, callback: callback(oid, "success", "2000000"), now: at(41) });
  assert.deepEqual([first.httpStatus, first.body, first.result], [200, "OK", "paid"]);
  for (let i = 0; i < 3; i++) assert.equal((await processPaytrCallback(db, { config, callback: callback(oid, "success", "2000000"), now: at(42) })).result, "already_paid");
  const rows = await attempts(o.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.status, "paid");
  const [order] = await db.select().from(orders).where(eq(orders.id, o.id));
  assert.deepEqual([order!.status, order!.paymentStatus], ["paid", "paid"]);
  assert.equal(await auditCount(o.id, "paytr_callback_success"), 1);
  assert.equal(await auditCount(o.id, "payment_paid"), 1);
  const [inv1] = await db.select().from(inventory).where(eq(inventory.productId, productId));
  assert.deepEqual([inv1!.onHand, inv1!.reserved], [inv0!.onHand, inv0!.reserved], "callbacks never touch stock");
  assert.deepEqual(await loadPaytrAttempt(db, oid), { orderNumber: o.orderNumber, status: "paid" });
  const again = await start(o);
  assert.equal(!again.ok && again.code, "ALREADY_PAID");
});

test("invalid hash: 400, no state change, audited as invalid", { skip }, async () => {
  const o = await makeOrder(7, 3000);
  const r = await start(o);
  const oid = r.ok ? r.merchantOid : "";
  const out = await processPaytrCallback(db, { config, callback: { ...callback(oid, "success", "300000"), hash: "forged" }, now: at(41) });
  assert.deepEqual([out.httpStatus, out.result], [400, "invalid_hash"]);
  assert.equal((await attempts(o.id))[0]!.status, "pending");
  assert.equal((await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, oid), eq(auditLogs.action, "paytr_invalid_callback")))).length, 1);
  const tampered = await processPaytrCallback(db, { config, callback: { ...callback(oid, "success", "300000"), paymentAmount: "1", totalAmount: "1" }, now: at(41) });
  assert.equal(tampered.result, "invalid_hash", "amount changed after signing");
});

test("unknown merchant_oid with a valid hash: acknowledged, audited, nothing created", { skip }, async () => {
  const before = (await db.select().from(payments)).length;
  const out = await processPaytrCallback(db, { config, callback: callback(`UNKNOWN${run}`, "success", "100"), now: at(41) });
  assert.deepEqual([out.httpStatus, out.result], [200, "unknown_reference"]);
  assert.equal((await db.select().from(payments)).length, before);
});

test("failed callback: attempt failed with server-side reason, order kept, retry allowed; a later failure never undoes a success", { skip }, async () => {
  const o = await makeOrder(8, 4000);
  const r = await start(o);
  const oid = r.ok ? r.merchantOid : "";
  const out = await processPaytrCallback(db, { config, callback: callback(oid, "failed", "400000", { failedReasonCode: "2", failedReasonMsg: "Yetersiz bakiye" }), now: at(41) });
  assert.equal(out.result, "failed");
  const [row] = await attempts(o.id);
  assert.equal(row!.status, "failed");
  assert.equal((row!.metadata as { failureCode?: string }).failureCode, "2");
  assert.equal((await processPaytrCallback(db, { config, callback: callback(oid, "failed", "400000"), now: at(41) })).result, "ignored_failure");
  assert.equal(await auditCount(o.id, "paytr_callback_failed"), 1);
  const [order] = await db.select().from(orders).where(eq(orders.id, o.id));
  assert.equal(order!.status, "pending_payment");
  const retry = await start(o);
  assert.equal(retry.ok, true);
  const oid2 = retry.ok ? retry.merchantOid : "";
  await processPaytrCallback(db, { config, callback: callback(oid2, "success", "400000"), now: at(42) });
  const late = await processPaytrCallback(db, { config, callback: callback(oid2, "failed", "400000"), now: at(43) });
  assert.equal(late.result, "ignored_failure");
  assert.equal((await db.select().from(payments).where(eq(payments.providerTransactionId, oid2)))[0]!.status, "paid");
});

test("amount mismatch: never counted as collected, flagged and audited once", { skip }, async () => {
  const o = await makeOrder(9, 9000);
  const r = await start(o);
  const oid = r.ok ? r.merchantOid : "";
  for (let i = 0; i < 2; i++) assert.equal((await processPaytrCallback(db, { config, callback: callback(oid, "success", "100", { paymentAmount: "100" }), now: at(41) })).result, "amount_mismatch");
  const [row] = await attempts(o.id);
  assert.equal(row!.status, "pending");
  assert.equal(await auditCount(o.id, "paytr_callback_amount_mismatch"), 1);
  assert.equal(await auditCount(o.id, "payment_paid"), 0);
});

test("online attempts never leak into collected until paid; manual EFT still bounds by the real balance", { skip }, async () => {
  const o = await makeOrder(10, 10000);
  await start(o);
  const report = await loadFinanceReport(db, { range: { start: at(10), end: at(11) }, filters: {}, page: 1, pageSize: 500 });
  const row = report.rows.find((r) => r.orderNumber === o.orderNumber);
  assert.deepEqual([row?.collected, row?.outstanding, row?.paymentStatus], [0, 10000, "pending"], "a pending online attempt is not collected money");
  const manual = await recordManualPayment(db, { orderId: o.id, body: { amount: 10000, method: "bank_transfer", reference: "EFT-1", note: "" }, actor: admin, idempotencyKey: `ptr-eft-${run}`, now: at(41) });
  assert.equal(manual.ok, true);
  const oid = (await attempts(o.id)).find((p) => p.provider === "paytr")!.providerTransactionId!;
  const late = await processPaytrCallback(db, { config, callback: callback(oid, "success", "1000000"), now: at(42) });
  assert.equal(late.result, "paid", "money that really moved is recorded, never dropped");
  const [paid] = await db.select().from(payments).where(eq(payments.providerTransactionId, oid));
  assert.equal((paid!.metadata as { reviewRequired?: boolean }).reviewRequired, true, "double collection is flagged for review");
});

test("parallel duplicate callbacks and a parallel double start are serialized by the order row lock", { skip }, async () => {
  const o = await makeOrder(11, 7000);
  const starts = await Promise.all([start(o), start(o)]);
  assert.equal(starts.filter((s) => s.ok).length >= 1, true);
  for (const s of starts) if (!s.ok) assert.equal(s.code, "ATTEMPT_IN_PROGRESS");
  const live = (await attempts(o.id)).filter((p) => p.status === "pending");
  assert.equal(live.length, 1, "one live attempt per order");
  const oid = live[0]!.providerTransactionId!;
  const results = await Promise.all(Array.from({ length: 5 }, () => processPaytrCallback(db, { config, callback: callback(oid, "success", "700000"), now: at(41) })));
  assert.deepEqual(results.map((r) => r.result).sort(), ["already_paid", "already_paid", "already_paid", "already_paid", "paid"]);
  assert.equal(await auditCount(o.id, "payment_paid"), 1);
});
