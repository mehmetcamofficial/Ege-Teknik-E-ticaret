import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildFinanceSummary, cancellationBlockedByCollection, derivePaymentStatus, ledgerCoversOrder, manualPaymentMethods, manualPaymentSchema,
  orderPaymentStatuses, outstandingAmount, pageCountFor, paymentMethods, refundSchema, resolvePaidAt, samePaymentRequest, sameRefundRequest,
  validateManualPayment, validateRefund,
} from "../lib/finance.ts";
import { financeQuerySchema } from "../lib/finance-db.ts";
import { calculateLine, computeOrderTotals, priceOrderLines } from "../lib/order-domain.ts";
import { paymentStatusLabel, paymentStatusTone } from "../lib/admin-ui.ts";
import { roleHasPermission, adminRoles } from "../lib/security-policy.ts";
import { destructiveReasons } from "./support/migration-sql.ts";

/** Phase 3.3A finance core: every money rule without a database. tests/finance-db.test.ts runs the SQL for real. */
const read = (f: string) => readFileSync(f, "utf8");
const code = (r: { ok: boolean; refusal?: { code: string } }) => (r.ok ? "ok" : r.refusal!.code);

// ---- order total & VAT ---------------------------------------------------------------------------------------
test("order total is the sum of VAT-inclusive lines; VAT is extracted from the line, net = total - VAT, all integers", () => {
  const lines = priceOrderLines([{ id: "a", price: 30_000, vatRateBps: 2000 }, { id: "b", price: 1_199, vatRateBps: 2000 }], new Map([["a", 2], ["b", 1]]));
  const totals = computeOrderTotals(lines);
  assert.equal(totals.total, 61_199);
  assert.equal(totals.vatTotal, 10_000 + Math.round(1_199 * 2000 / 12_000));
  assert.equal(totals.subtotal + totals.vatTotal, totals.total);
  for (const v of Object.values(totals)) assert.ok(Number.isInteger(v));
  assert.equal(calculateLine(100, 1, 0).vatAmount, 0);
});

test("the finance summary converts driver strings exactly and computes net collected; bad aggregates fail loudly", () => {
  const s = buildFinanceSummary({ orderCount: 3, cancelledCount: 1, orderValue: "2500", netOrderValue: "2084", vatTotal: "416", cancelledValue: "700", collected: "1800", refunded: "300", outstanding: "700", unbackedPaidCount: 0 });
  assert.equal(s.netCollected, 1500);
  assert.equal(s.netOrderValue + s.vatTotal, s.orderValue);
  assert.throws(() => buildFinanceSummary({ orderCount: 1, cancelledCount: 0, orderValue: "12.5x", netOrderValue: "0", vatTotal: "0", cancelledValue: "0", collected: "0", refunded: "0", outstanding: "0", unbackedPaidCount: 0 }));
});

test("empty data is all zeros, never an invented figure, and still one page", () => {
  const s = buildFinanceSummary({ orderCount: 0, cancelledCount: 0, orderValue: "0", netOrderValue: "0", vatTotal: "0", cancelledValue: "0", collected: "0", refunded: "0", outstanding: "0", unbackedPaidCount: 0 });
  assert.deepEqual(Object.values(s).filter((v) => v !== 0), []);
  assert.equal(pageCountFor(0), 1);
  assert.equal(pageCountFor(26, 25), 2);
});

// ---- paid vs pending ------------------------------------------------------------------------------------------
test("payment status is derived from the ledger only: nothing recorded = pending, whatever the order says", () => {
  assert.equal(derivePaymentStatus({ total: 1000, orderStatus: "paid", collected: 0, refunded: 0 }), "pending");
  assert.equal(derivePaymentStatus({ total: 1000, orderStatus: "pending_payment", collected: 400, refunded: 0 }), "partially_paid");
  assert.equal(derivePaymentStatus({ total: 1000, orderStatus: "pending_payment", collected: 1000, refunded: 0 }), "paid");
  assert.equal(derivePaymentStatus({ total: 1000, orderStatus: "cancelled", collected: 0, refunded: 0 }), "cancelled");
  assert.equal(derivePaymentStatus({ total: 1000, orderStatus: "cancelled", collected: 1000, refunded: 1000 }), "refunded");
  assert.equal(derivePaymentStatus({ total: 1000, orderStatus: "delivered", collected: 1000, refunded: 250 }), "partially_refunded");
});

test("the SQL CASE in finance-db mirrors derivePaymentStatus branch for branch", () => {
  const sql = read("lib/finance-db.ts");
  assert.match(sql, /when refunded > 0 then case when refunded >= collected then 'refunded' else 'partially_refunded' end\s+when collected > 0 and collected >= total then 'paid'\s+when collected > 0 then 'partially_paid'\s+when status = 'cancelled' then 'cancelled'\s+else 'pending'/);
});

test("'paid' order status requires the ledger to hold the full total", () => {
  assert.equal(ledgerCoversOrder(1000, 0, 0), false);
  assert.equal(ledgerCoversOrder(1000, 999, 0), false);
  assert.equal(ledgerCoversOrder(1000, 1000, 0), true);
  assert.equal(ledgerCoversOrder(1000, 1000, 1), false);
});

test("the order status route can no longer mark payment_status 'paid' by itself", () => {
  const route = read("app/api/admin/orders/[id]/route.ts");
  assert.doesNotMatch(route, /paymentStatus:\s*"paid"/);
  // Reconciled with Sprint B: the route delegates to the shared compare-and-set transition (lib/order-transition.ts), which now carries the finance guards.
  assert.match(route, /transitionOrder/);
  assert.match(route, /"PAYMENT_NOT_RECORDED"|PAYMENT_NOT_RECORDED/);
  assert.match(read("lib/order-transition.ts"), /code: "PAYMENT_NOT_RECORDED"/);
});

// ---- manual payments ------------------------------------------------------------------------------------------
test("a manual payment is bounded by the outstanding balance and refused on closed orders", () => {
  const base = { orderStatus: "pending_payment", total: 1000, collected: 0 };
  assert.equal(code(validateManualPayment({ ...base, amount: 1000 })), "ok");
  assert.equal(code(validateManualPayment({ ...base, collected: 600, amount: 401 })), "OVERPAYMENT");
  assert.equal(code(validateManualPayment({ ...base, collected: 1000, amount: 1 })), "NOTHING_DUE");
  assert.equal(code(validateManualPayment({ ...base, amount: 0 })), "INVALID_AMOUNT");
  assert.equal(code(validateManualPayment({ ...base, amount: 10.5 })), "INVALID_AMOUNT");
  assert.equal(code(validateManualPayment({ ...base, orderStatus: "cancelled", amount: 10 })), "ORDER_CLOSED");
  assert.equal(outstandingAmount(1000, 1200), 0);
});

test("manual payment bodies: integer TL, manual methods only - 'online' can never be recorded by hand", () => {
  assert.equal(manualPaymentSchema.safeParse({ amount: 500, method: "cash" }).success, true);
  assert.equal(manualPaymentSchema.safeParse({ amount: 500, method: "online" }).success, false);
  assert.equal(manualPaymentSchema.safeParse({ amount: 500.5, method: "cash" }).success, false);
  assert.equal(manualPaymentSchema.safeParse({ amount: "500", method: "cash" }).success, false);
  assert.deepEqual([...manualPaymentMethods].sort(), paymentMethods.filter((m) => m !== "online").sort());
});

test("received-at: never in the future, never before the order", () => {
  const created = new Date("2026-09-01T10:00:00Z"), now = new Date("2026-09-10T10:00:00Z");
  assert.equal(resolvePaidAt(undefined, created, now).ok, true);
  assert.equal(code(resolvePaidAt("2026-09-11T10:00:00Z", created, now)), "PAID_AT_IN_FUTURE");
  assert.equal(code(resolvePaidAt("2026-08-30T10:00:00Z", created, now)), "PAID_AT_BEFORE_ORDER");
});

// ---- refunds --------------------------------------------------------------------------------------------------
const paid = { status: "paid", amount: 1000, method: "cash" };
test("full and partial refunds are allowed up to what the payment still holds", () => {
  assert.equal(code(validateRefund({ payment: paid, refundedOnPayment: 0, amount: 1000 })), "ok");
  assert.equal(code(validateRefund({ payment: paid, refundedOnPayment: 0, amount: 250 })), "ok");
  assert.equal(code(validateRefund({ payment: paid, refundedOnPayment: 250, amount: 750 })), "ok");
});
test("refund above the payment, on a fully refunded payment, on an unpaid or provider payment is refused", () => {
  assert.equal(code(validateRefund({ payment: paid, refundedOnPayment: 0, amount: 1001 })), "REFUND_EXCEEDS_PAYMENT");
  assert.equal(code(validateRefund({ payment: paid, refundedOnPayment: 250, amount: 751 })), "REFUND_EXCEEDS_PAYMENT");
  assert.equal(code(validateRefund({ payment: paid, refundedOnPayment: 1000, amount: 1 })), "ALREADY_REFUNDED");
  assert.equal(code(validateRefund({ payment: { ...paid, status: "pending" }, refundedOnPayment: 0, amount: 1 })), "PAYMENT_NOT_PAID");
  assert.equal(code(validateRefund({ payment: { ...paid, method: "online" }, refundedOnPayment: 0, amount: 1 })), "PROVIDER_REFUND_UNAVAILABLE");
  assert.equal(code(validateRefund({ payment: null, refundedOnPayment: 0, amount: 1 })), "PAYMENT_NOT_FOUND");
  assert.equal(refundSchema.safeParse({ paymentId: "p", amount: 10, reason: "" }).success, false, "a refund needs a reason");
});

test("idempotency: the same key replays only an identical request; any difference is key reuse", () => {
  const body = { amount: 300, method: "pos" as const, reference: "SLIP", note: "" };
  const stored = { orderId: "o1", amount: 300, method: "pos", reference: "SLIP", note: "" };
  assert.equal(samePaymentRequest(stored, "o1", body), true);
  assert.equal(samePaymentRequest(stored, "o2", body), false);
  assert.equal(samePaymentRequest(stored, "o1", { ...body, amount: 301 }), false);
  const refund = { orderId: "o1", paymentId: "p1", amount: 50, reason: "hasar" };
  assert.equal(sameRefundRequest(refund, "o1", { paymentId: "p1", amount: 50, reason: "hasar" }), true);
  assert.equal(sameRefundRequest(refund, "o1", { paymentId: "p1", amount: 51, reason: "hasar" }), false);
});

test("the payment and refund routes require an Idempotency-Key", () => {
  for (const f of ["app/api/admin/orders/[id]/payments/route.ts", "app/api/admin/orders/[id]/refunds/route.ts"]) {
    assert.match(read(f), /IDEMPOTENCY_KEY_REQUIRED/, f);
  }
});

// ---- cancellation ---------------------------------------------------------------------------------------------
test("cancellation is blocked while collected money is still held; allowed once refunded", () => {
  assert.equal(cancellationBlockedByCollection(0, 0), false);
  assert.equal(cancellationBlockedByCollection(1000, 0), true);
  assert.equal(cancellationBlockedByCollection(1000, 400), true);
  assert.equal(cancellationBlockedByCollection(1000, 1000), false);
});

// ---- filters ----------------------------------------------------------------------------------------------------
test("date range, payment status, order status and method filters parse from closed lists; anything else is 400", () => {
  const ok = financeQuerySchema.safeParse({ range: "custom", from: "2026-09-01", to: "2026-09-27", paymentStatus: "partially_paid", orderStatus: "cancelled", method: "bank_transfer", page: "2" });
  assert.equal(ok.success, true);
  assert.equal(ok.success && ok.data.page, 2);
  const blank = financeQuerySchema.safeParse({ paymentStatus: "", orderStatus: "", method: "" });
  assert.equal(blank.success && blank.data.range, "7d");
  assert.equal(blank.success && blank.data.page, 1);
  for (const bad of [{ method: "crypto" }, { paymentStatus: "PAID" }, { orderStatus: "x" }, { page: "0" }, { range: "5y" }]) assert.equal(financeQuerySchema.safeParse(bad).success, false, JSON.stringify(bad));
});

test("payment status vocabulary is complete in the admin UI", () => {
  assert.deepEqual(Object.keys(paymentStatusLabel).sort(), [...orderPaymentStatuses].sort());
  assert.deepEqual(Object.keys(paymentStatusTone).sort(), [...orderPaymentStatuses].sort());
});

// ---- RBAC -------------------------------------------------------------------------------------------------------
test("finance reads need admin:read; payment and refund writes need orders:write; checked before any work", () => {
  const permission = (f: string, method: string) => {
    const src = read(f);
    const body = src.slice(src.indexOf(`export async function ${method}`));
    return body.match(/getAdminUser\("([a-z:]+)"\)/)?.[1];
  };
  assert.equal(permission("app/api/admin/finance/route.ts", "GET"), "admin:read");
  assert.equal(permission("app/api/admin/orders/[id]/payments/route.ts", "GET"), "admin:read");
  assert.equal(permission("app/api/admin/orders/[id]/payments/route.ts", "POST"), "orders:write");
  assert.equal(permission("app/api/admin/orders/[id]/refunds/route.ts", "POST"), "orders:write");
  assert.equal(permission("app/api/admin/orders/[id]/route.ts", "PATCH"), "orders:write");
  assert.equal(permission("app/api/admin/orders/[id]/route.ts", "GET"), "admin:read");
  for (const role of ["viewer", "catalog_manager"]) assert.equal(roleHasPermission(role, "orders:write"), false, `${role} cannot record money`);
  for (const role of adminRoles) assert.equal(roleHasPermission(role, "admin:read"), true);
  assert.equal(roleHasPermission("", "admin:read"), false);
});

test("the client finance module stays browser-safe and never embeds server code", () => {
  const src = read("lib/finance.ts");
  assert.doesNotMatch(src, /^import .* from "(node:|@\/db|drizzle-orm|[^"]*order-domain)/m);
  assert.match(src, /^import .* from "\.\/analytics\.ts";$/m);
});

test("no money value from the client is trusted as a total: amounts are bounded server-side, totals come from SQL", () => {
  const db = read("lib/finance-db.ts");
  assert.match(db, /validateManualPayment\(\{ orderStatus: order\.status, total: order\.total, collected/);
  assert.match(db, /for\("update"\)/);
  assert.doesNotMatch(read("app/api/admin/finance/route.ts"), /request\.json|readJson/);
});

// ---- order detail lines ------------------------------------------------------------------------------------------
test("order lines come from the order_items snapshot; only the thumbnail is read from the product", () => {
  const route = read("app/api/admin/orders/[id]/route.ts");
  const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function PATCH"));
  for (const field of ["unitPrice:orderItems.unitPrice", "vatAmount:orderItems.vatAmount", "lineTotal:orderItems.lineTotal", "quantity:orderItems.quantity", "productName:orderItems.productName", "productSku:orderItems.productSku"]) assert.ok(get.includes(field), field);
  assert.doesNotMatch(get, /products\.(price|vatRateBps|name|sku)/, "no live product price, VAT, name or SKU in an order line");
  assert.match(route, /url\.startsWith\("https:\/\/"\)\|\|\(url\.startsWith\("\/"\)&&!url\.startsWith\("\/\/"\)\)/, "thumbnail limited to https or site-relative URLs");
});
test("the order detail lists its lines instead of the old placeholder", () => {
  const view = read("app/admin/(panel)/orders/order-detail-view.tsx");
  assert.doesNotMatch(view, /henüz listelenmiyor/);
  assert.match(view, /<OrderItemsPanel orderId=\{order\.id\} \/>/);
  for (const panel of ["PaymentSummaryPanel", "PaymentHistoryPanel", "PaymentActionPanels"]) assert.match(view, new RegExp(`<${panel} `), panel);
  assert.match(view, /\{canWrite && \(/, "entry cards and status controls stay behind orders:write in the UI");
});

// ---- migration 0013 ---------------------------------------------------------------------------------------------
const migration = read("drizzle-pg/0013_finance_ledger.sql");
test("migration 0013 is journaled after 0012 and is additive: no DROP/DELETE/UPDATE/INSERT/RENAME/ALTER COLUMN", () => {
  const entries = JSON.parse(read("drizzle-pg/meta/_journal.json")).entries as { idx: number; tag: string }[];
  assert.deepEqual(entries.slice(-2).map((e) => [e.idx, e.tag]), [[12, "0012_delivery_class"], [13, "0013_finance_ledger"]]);
  assert.deepEqual(destructiveReasons(migration), []);
  assert.doesNotMatch(migration, /ALTER TABLE "(?!payments"|refunds")/, "only payments and refunds are touched");
});
test("0013 CHECKs are NOT VALID (bind new rows, never rescan history) and nothing is seeded", () => {
  const checks = migration.split("--> statement-breakpoint").filter((s) => / CHECK \(/.test(s));
  assert.equal(checks.length, 7);
  for (const c of checks) assert.match(c, /NOT VALID;/);
  assert.doesNotMatch(migration, /INSERT INTO|VALUES \(/i);
});
