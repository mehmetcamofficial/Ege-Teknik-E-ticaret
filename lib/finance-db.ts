import { z } from "zod";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { auditLogs, orders, payments, refunds } from "../db/schema.ts";
import {
  FINANCE_PAGE_SIZE, MANUAL_PROVIDER, buildFinanceSummary, derivePaymentStatus, outstandingAmount,
  orderPaymentStatuses, pageCountFor, paymentMethods, resolvePaidAt, sameRefundRequest, samePaymentRequest, validateManualPayment, validateRefund,
  type FinanceFilters, type FinanceMethodRow, type FinanceRefusal, type FinanceReport, type FinanceReportRow, type ManualPaymentInput, type OrderPaymentStatus, type PaymentMethod, type RawFinanceSummary, type RefundInput,
} from "./finance.ts";
import { orderStatuses } from "./order-domain.ts";
import { analyticsQuerySchema, type ResolvedRange } from "./analytics.ts";
import { findSecretLeak } from "./security-policy.ts";

/**
 * Finance persistence (Phase 3.3A). Every function takes the database as a parameter so the routes pass getDb()
 * and tests/finance-db.test.ts can run the same code against a real PostgreSQL. Relative imports on purpose: this
 * module must load under plain `node --test` without the Next.js path alias.
 *
 * Concurrency: every write locks the order row (SELECT ... FOR UPDATE) before reading the ledger, so two payments,
 * two refunds or a payment racing a cancellation are serialized per order and a limit can never be passed twice.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FinanceDb = NodePgDatabase<any>;
export type Tx = Parameters<Parameters<FinanceDb["transaction"]>[0]>[0];
export type FinanceActor = { userId: string; email: string };
type Refused = { ok: false; refusal: FinanceRefusal };
const refused = (status: number, code: string, error: string): Refused => ({ ok: false, refusal: { status, code, error } });

/** Same table and the same secret-shaped-key guard as lib/admin-auth.ts auditPrivileged - not a parallel audit system. */
export async function audit(tx: Tx, actor: FinanceActor, action: string, entityType: string, entityId: string, payload: Record<string, unknown>) {
  const leak = findSecretLeak(payload);
  if (leak) throw new Error(`audit payload refused: secret-shaped key "${leak}"`);
  await tx.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.userId, actorEmail: actor.email, action, entityType, entityId, payload });
}

async function lockOrder(tx: Tx, orderId: string) {
  const [order] = await tx.select({ id: orders.id, status: orders.status, total: orders.total, paymentStatus: orders.paymentStatus, createdAt: orders.createdAt }).from(orders).where(eq(orders.id, orderId)).for("update").limit(1);
  return order ?? null;
}

export async function ledgerSums(tx: Tx | FinanceDb, orderId: string) {
  const [pay] = await tx.select({ n: sql<string>`coalesce(sum(${payments.amount}), 0)::bigint` }).from(payments).where(and(eq(payments.orderId, orderId), eq(payments.status, "paid")));
  const [ref] = await tx.select({ n: sql<string>`coalesce(sum(${refunds.amount}), 0)::bigint` }).from(refunds).where(and(eq(refunds.orderId, orderId), eq(refunds.status, "completed")));
  return { collected: Number(pay?.n ?? 0), refunded: Number(ref?.n ?? 0) };
}

// ---- manual payment ----------------------------------------------------------------------------------------------
export async function recordManualPayment(db: FinanceDb, input: { orderId: string; body: ManualPaymentInput; actor: FinanceActor; idempotencyKey: string; now?: Date }):
  Promise<{ ok: true; replayed: boolean; paymentId: string; paymentStatus: OrderPaymentStatus | string } | Refused> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, input.orderId);
    if (!order) return refused(404, "ORDER_NOT_FOUND", "Sipariş bulunamadı.");
    const [existing] = await tx.select().from(payments).where(eq(payments.idempotencyKey, input.idempotencyKey)).limit(1);
    if (existing) {
      if (!samePaymentRequest(existing, input.orderId, input.body)) return refused(409, "IDEMPOTENCY_KEY_REUSED", "Bu istek anahtarı farklı bir ödeme için kullanıldı.");
      return { ok: true as const, replayed: true, paymentId: existing.id, paymentStatus: order.paymentStatus };
    }
    const { collected, refunded } = await ledgerSums(tx, order.id);
    const valid = validateManualPayment({ orderStatus: order.status, total: order.total, collected, amount: input.body.amount });
    if (!valid.ok) return valid;
    const paidAt = resolvePaidAt(input.body.paidAt, order.createdAt, now);
    if (!paidAt.ok) return paidAt;
    const paymentId = crypto.randomUUID();
    const inserted = await tx.insert(payments).values({
      id: paymentId, orderId: order.id, provider: MANUAL_PROVIDER, amount: input.body.amount, currency: "TRY", status: "paid", paidAt: paidAt.at,
      method: input.body.method, reference: input.body.reference, note: input.body.note, recordedBy: input.actor.userId, idempotencyKey: input.idempotencyKey,
    }).onConflictDoNothing().returning({ id: payments.id });
    if (!inserted.length) return refused(409, "IDEMPOTENCY_KEY_REUSED", "Bu istek anahtarı farklı bir ödeme için kullanıldı.");
    const next = derivePaymentStatus({ total: order.total, orderStatus: order.status, collected: collected + input.body.amount, refunded });
    await tx.update(orders).set({ paymentStatus: next, updatedAt: now }).where(eq(orders.id, order.id));
    await audit(tx, input.actor, "payment_recorded", "order", order.id, {
      paymentId, amount: input.body.amount, method: input.body.method, reference: input.body.reference, paidAt: paidAt.at.toISOString(),
      paymentStatus: { from: order.paymentStatus, to: next }, collected: { from: collected, to: collected + input.body.amount },
    });
    return { ok: true as const, replayed: false, paymentId, paymentStatus: next };
  });
}

// ---- refund ------------------------------------------------------------------------------------------------------
export async function recordRefund(db: FinanceDb, input: { orderId: string; body: RefundInput; actor: FinanceActor; idempotencyKey: string; now?: Date }):
  Promise<{ ok: true; replayed: boolean; refundId: string; paymentStatus: OrderPaymentStatus | string; full: boolean } | Refused> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, input.orderId);
    if (!order) return refused(404, "ORDER_NOT_FOUND", "Sipariş bulunamadı.");
    const [existing] = await tx.select().from(refunds).where(eq(refunds.idempotencyKey, input.idempotencyKey)).limit(1);
    if (existing) {
      if (!sameRefundRequest(existing, input.orderId, input.body)) return refused(409, "IDEMPOTENCY_KEY_REUSED", "Bu istek anahtarı farklı bir iade için kullanıldı.");
      return { ok: true as const, replayed: true, refundId: existing.id, paymentStatus: order.paymentStatus, full: false };
    }
    const [payment] = await tx.select({ id: payments.id, status: payments.status, amount: payments.amount, method: payments.method }).from(payments)
      .where(and(eq(payments.id, input.body.paymentId), eq(payments.orderId, order.id))).for("update").limit(1);
    const [onPayment] = await tx.select({ n: sql<string>`coalesce(sum(${refunds.amount}), 0)::bigint` }).from(refunds).where(and(eq(refunds.paymentId, input.body.paymentId), eq(refunds.status, "completed")));
    const refundedOnPayment = Number(onPayment?.n ?? 0);
    const valid = validateRefund({ payment: payment ?? null, refundedOnPayment, amount: input.body.amount });
    if (!valid.ok) return valid;
    const refundId = crypto.randomUUID();
    const inserted = await tx.insert(refunds).values({
      id: refundId, orderId: order.id, paymentId: payment!.id, amount: input.body.amount, currency: "TRY", status: "completed", refundedAt: now,
      reason: input.body.reason, createdBy: input.actor.userId, idempotencyKey: input.idempotencyKey,
    }).onConflictDoNothing().returning({ id: refunds.id });
    if (!inserted.length) return refused(409, "IDEMPOTENCY_KEY_REUSED", "Bu istek anahtarı farklı bir iade için kullanıldı.");
    const full = refundedOnPayment + input.body.amount === payment!.amount;
    if (full) await tx.update(payments).set({ refundedAt: now, updatedAt: now }).where(eq(payments.id, payment!.id));
    const { collected, refunded } = await ledgerSums(tx, order.id);
    const next = derivePaymentStatus({ total: order.total, orderStatus: order.status, collected, refunded });
    await tx.update(orders).set({ paymentStatus: next, updatedAt: now }).where(eq(orders.id, order.id));
    await audit(tx, input.actor, full ? "refund_full" : "refund_partial", "order", order.id, {
      refundId, paymentId: payment!.id, amount: input.body.amount, reason: input.body.reason,
      paymentStatus: { from: order.paymentStatus, to: next }, refunded: { from: refunded - input.body.amount, to: refunded },
    });
    return { ok: true as const, replayed: false, refundId, paymentStatus: next, full };
  });
}

// ---- order status (finance-guarded) ------------------------------------------------------------------------------
export async function loadOrderLedger(db: FinanceDb, orderId: string) {
  const [order] = await db.select({ id: orders.id, status: orders.status, total: orders.total, paymentStatus: orders.paymentStatus }).from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return null;
  const paymentRows = await db.select({ id: payments.id, provider: payments.provider, method: payments.method, amount: payments.amount, status: payments.status, reference: payments.reference, note: payments.note, paidAt: payments.paidAt, refundedAt: payments.refundedAt, createdAt: payments.createdAt })
    .from(payments).where(eq(payments.orderId, orderId)).orderBy(asc(payments.createdAt));
  const refundRows = await db.select({ id: refunds.id, paymentId: refunds.paymentId, amount: refunds.amount, status: refunds.status, reason: refunds.reason, refundedAt: refunds.refundedAt, createdAt: refunds.createdAt })
    .from(refunds).where(eq(refunds.orderId, orderId)).orderBy(asc(refunds.createdAt));
  const { collected, refunded } = await ledgerSums(db, orderId);
  const derived = derivePaymentStatus({ total: order.total, orderStatus: order.status, collected, refunded });
  return {
    orderId: order.id, total: order.total, orderStatus: order.status, storedPaymentStatus: order.paymentStatus, paymentStatus: derived,
    unbackedPaid: order.paymentStatus === "paid" && collected === 0,
    collected, refunded, netCollected: collected - refunded, outstanding: outstandingAmount(order.total, collected),
    payments: paymentRows.map((p) => ({ ...p, refundedAmount: refundRows.filter((r) => r.paymentId === p.id && r.status === "completed").reduce((s, r) => s + r.amount, 0) })),
    refunds: refundRows,
  };
}

// ---- dashboard + sales report ------------------------------------------------------------------------------------
const emptyToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);
/** GET /api/admin/finance query: the analytics date range plus closed-list filters and a page number. */
export const financeQuerySchema = analyticsQuerySchema.extend({
  paymentStatus: z.preprocess(emptyToUndefined, z.enum(orderPaymentStatuses).optional()),
  orderStatus: z.preprocess(emptyToUndefined, z.enum(orderStatuses).optional()),
  method: z.preprocess(emptyToUndefined, z.enum(paymentMethods).optional()),
  page: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(10_000).default(1)),
});

/**
 * One CTE feeds the summary, the per-method cash view and the paged report, so the three can never disagree.
 * The payment status is DERIVED here from the ledger (the same rule as derivePaymentStatus); the stored column is
 * only used to count legacy "paid" flags that have no payment behind them. The date filter is the ORDER's
 * creation time (a cohort view): "collected" means collected for orders created in the window.
 */
function financeBase(range: ResolvedRange): SQL {
  return sql`
    with pay as (
      select order_id,
        coalesce(sum(amount) filter (where status = 'paid'), 0)::bigint as collected,
        coalesce(array_agg(distinct method) filter (where status = 'paid' and method is not null), '{}') as methods
      from payments group by order_id
    ),
    ref as (select order_id, coalesce(sum(amount) filter (where status = 'completed'), 0)::bigint as refunded from refunds group by order_id),
    ret as (select order_id, count(*)::int as returns_count from returns group by order_id),
    ledger as (
      select o.id, o.order_number, o.created_at, o.customer_name, o.total, o.subtotal, o.vat_total, o.status,
        o.payment_status as stored_payment_status,
        coalesce(pay.collected, 0)::bigint as collected, coalesce(ref.refunded, 0)::bigint as refunded,
        coalesce(pay.methods, '{}') as methods, coalesce(ret.returns_count, 0) as returns_count
      from orders o
      left join pay on pay.order_id = o.id
      left join ref on ref.order_id = o.id
      left join ret on ret.order_id = o.id
      where o.created_at >= ${range.start} and o.created_at <= ${range.end}
    ),
    base as (
      select ledger.*,
        case
          when refunded > 0 then case when refunded >= collected then 'refunded' else 'partially_refunded' end
          when collected > 0 and collected >= total then 'paid'
          when collected > 0 then 'partially_paid'
          when status = 'cancelled' then 'cancelled'
          else 'pending'
        end as payment_status
      from ledger
    )`;
}

function filterClause(filters: FinanceFilters): SQL {
  const parts: SQL[] = [sql`true`];
  if (filters.paymentStatus) parts.push(sql`payment_status = ${filters.paymentStatus}`);
  if (filters.orderStatus) parts.push(sql`status = ${filters.orderStatus}`);
  if (filters.method) parts.push(sql`${filters.method} = any(methods)`);
  return sql.join(parts, sql` and `);
}

type Row = Record<string, unknown>;
const rowsOf = (result: unknown): Row[] => (result as { rows: Row[] }).rows;

export async function loadFinanceReport(db: FinanceDb, input: { range: ResolvedRange; filters: FinanceFilters; page: number; pageSize?: number }): Promise<FinanceReport> {
  const pageSize = input.pageSize ?? FINANCE_PAGE_SIZE;
  const base = financeBase(input.range), where = filterClause(input.filters);
  const [summaryResult, methodResult] = await Promise.all([
    db.execute(sql`${base}
      select count(*)::int as "orderCount",
        count(*) filter (where status = 'cancelled')::int as "cancelledCount",
        coalesce(sum(total) filter (where status <> 'cancelled'), 0)::bigint as "orderValue",
        coalesce(sum(subtotal) filter (where status <> 'cancelled'), 0)::bigint as "netOrderValue",
        coalesce(sum(vat_total) filter (where status <> 'cancelled'), 0)::bigint as "vatTotal",
        coalesce(sum(total) filter (where status = 'cancelled'), 0)::bigint as "cancelledValue",
        coalesce(sum(collected), 0)::bigint as "collected",
        coalesce(sum(refunded), 0)::bigint as "refunded",
        coalesce(sum(greatest(total - collected, 0)) filter (where status <> 'cancelled'), 0)::bigint as "outstanding",
        count(*) filter (where stored_payment_status = 'paid' and collected = 0)::int as "unbackedPaidCount"
      from base where ${where}`),
    db.execute(sql`${base}
      select coalesce(p.method, 'unknown') as "method", count(*)::int as "paymentCount",
        coalesce(sum(p.amount), 0)::bigint as "collected", coalesce(sum(pr.refunded), 0)::bigint as "refunded"
      from payments p
      join (select id from base where ${where}) b on b.id = p.order_id
      left join (select payment_id, sum(amount) filter (where status = 'completed') as refunded from refunds group by payment_id) pr on pr.payment_id = p.id
      where p.status = 'paid' ${input.filters.method ? sql`and p.method = ${input.filters.method}` : sql``}
      group by 1 order by 1`),
  ]);
  const summary = buildFinanceSummary(rowsOf(summaryResult)[0] as RawFinanceSummary);
  const pageCount = pageCountFor(summary.orderCount, pageSize);
  const page = Math.min(input.page, pageCount);
  const rowResult = await db.execute(sql`${base}
    select id, order_number, created_at, customer_name, total, subtotal, vat_total, status, stored_payment_status, payment_status, methods, collected, refunded, returns_count
    from base where ${where}
    order by created_at desc, id desc
    limit ${pageSize} offset ${(page - 1) * pageSize}`);
  const rows: FinanceReportRow[] = rowsOf(rowResult).map((r) => {
    const total = Number(r.total), collected = Number(r.collected);
    return {
      orderId: String(r.id), orderNumber: String(r.order_number), createdAt: new Date(r.created_at as string).toISOString(), customerName: String(r.customer_name),
      total, subtotal: Number(r.subtotal), vatTotal: Number(r.vat_total), orderStatus: String(r.status),
      paymentStatus: r.payment_status as OrderPaymentStatus, storedPaymentStatus: String(r.stored_payment_status),
      methods: (r.methods as PaymentMethod[]) ?? [], collected, refunded: Number(r.refunded),
      outstanding: String(r.status) === "cancelled" ? 0 : outstandingAmount(total, collected), returnsCount: Number(r.returns_count),
    };
  });
  const methods: FinanceMethodRow[] = rowsOf(methodResult).map((r) => ({ method: r.method as FinanceMethodRow["method"], paymentCount: Number(r.paymentCount), collected: Number(r.collected), refunded: Number(r.refunded) }));
  return { summary, methods, rows, page, pageSize, pageCount, range: { start: input.range.start.toISOString(), end: input.range.end.toISOString() } };
}
