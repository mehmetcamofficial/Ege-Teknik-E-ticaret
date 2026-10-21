import { z } from "zod";
import { toSafeNumber, type DbNumeric } from "./analytics.ts";

/**
 * Finance core (Phase 3.3A) - pure rules, no DB or framework import, so every money rule is unit-testable. Also
 * imported by the admin client view, so it must stay free of node:* modules (the query schema lives in finance-db.ts).
 *
 * MONEY: integer TL everywhere (the same unit as orders.total / order_items.line_total). No floats.
 *
 * TRUTH SOURCE: "collected" is ONLY the sum of `payments` rows with status 'paid'; "refunded" is ONLY the sum of
 * `refunds` rows with status 'completed'. `orders.payment_status` is a cache written from those two sums by the
 * finance write paths; it is never read as evidence of money. Legacy rows where an operator set "paid" by hand
 * without a payment record are reported separately (`unbackedPaidCount`), never counted as collected.
 *
 * ORDER STATUS vs PAYMENT STATUS stay separate: the order lifecycle (lib/order-domain.ts) is unchanged, and the
 * payment status below is derived from the ledger alone.
 */

export const paymentMethods = ["cash", "bank_transfer", "pos", "online"] as const;
export type PaymentMethod = typeof paymentMethods[number];
/** Methods an operator may record by hand. `online` only ever comes from a provider integration (none is active). */
export const manualPaymentMethods = ["cash", "bank_transfer", "pos"] as const;
export type ManualPaymentMethod = typeof manualPaymentMethods[number];
export const paymentMethodLabel: Record<PaymentMethod, string> = { cash: "Nakit", bank_transfer: "EFT / Havale", pos: "Fiziksel POS", online: "Online ödeme" };
export const MANUAL_PROVIDER = "manual";

export const orderPaymentStatuses = ["pending", "partially_paid", "paid", "failed", "cancelled", "refunded", "partially_refunded"] as const;
export type OrderPaymentStatus = typeof orderPaymentStatuses[number];

export type LedgerTotals = { total: number; orderStatus: string; collected: number; refunded: number };

/** Payment status derived from the ledger. Mirrored exactly by the CASE expression in lib/finance-db.ts. */
export function derivePaymentStatus({ total, orderStatus, collected, refunded }: LedgerTotals): OrderPaymentStatus {
  if (refunded > 0) return refunded >= collected ? "refunded" : "partially_refunded";
  if (collected > 0 && collected >= total) return "paid";
  if (collected > 0) return "partially_paid";
  if (orderStatus === "cancelled") return "cancelled";
  return "pending";
}

export const netCollected = (collected: number, refunded: number) => collected - refunded;
export const outstandingAmount = (total: number, collected: number) => Math.max(total - collected, 0);

/** Order statuses that no longer accept a new payment. */
const CLOSED_FOR_PAYMENT = new Set(["cancelled", "returned"]);

export type FinanceRefusal = { status: number; code: string; error: string };
export const refusalResponse = (refusal: FinanceRefusal) => Response.json({ error: refusal.error, code: refusal.code }, { status: refusal.status });
const refuse = (status: number, code: string, error: string): { ok: false; refusal: FinanceRefusal } => ({ ok: false, refusal: { status, code, error } });

/** A manual payment can never exceed what is still owed, so collected can never exceed the order total. */
export function validateManualPayment(input: { orderStatus: string; total: number; collected: number; amount: number }): { ok: true } | { ok: false; refusal: FinanceRefusal } {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) return refuse(400, "INVALID_AMOUNT", "Tutar pozitif bir tam sayı (TL) olmalıdır.");
  if (CLOSED_FOR_PAYMENT.has(input.orderStatus)) return refuse(409, "ORDER_CLOSED", "İptal edilmiş veya iade edilmiş siparişe ödeme kaydedilemez.");
  const due = outstandingAmount(input.total, input.collected);
  if (due === 0) return refuse(409, "NOTHING_DUE", "Bu siparişin tahsil edilecek bakiyesi yok.");
  if (input.amount > due) return refuse(409, "OVERPAYMENT", `Tutar kalan bakiyeyi (${due} TL) aşıyor.`);
  return { ok: true };
}

/**
 * A refund is money returned against ONE confirmed payment: at most what that payment still holds, so the order's
 * total refunds can never exceed what was collected. Provider-backed (`online`) payments are refused because no
 * provider refund call exists in this phase - the ledger must not claim money moved when it did not.
 */
export function validateRefund(input: { payment: { status: string; amount: number; method: string | null } | null; refundedOnPayment: number; amount: number }): { ok: true } | { ok: false; refusal: FinanceRefusal } {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) return refuse(400, "INVALID_AMOUNT", "Tutar pozitif bir tam sayı (TL) olmalıdır.");
  if (!input.payment) return refuse(404, "PAYMENT_NOT_FOUND", "Bu siparişe ait ödeme kaydı bulunamadı.");
  if (input.payment.status !== "paid") return refuse(409, "PAYMENT_NOT_PAID", "Yalnızca tahsil edilmiş bir ödeme için iade kaydedilebilir.");
  if (!input.payment.method || !(manualPaymentMethods as readonly string[]).includes(input.payment.method)) return refuse(409, "PROVIDER_REFUND_UNAVAILABLE", "Online ödeme iadesi sağlayıcı entegrasyonu olmadan kaydedilemez.");
  const refundable = input.payment.amount - input.refundedOnPayment;
  if (refundable <= 0) return refuse(409, "ALREADY_REFUNDED", "Bu ödeme zaten tamamen iade edilmiş.");
  if (input.amount > refundable) return refuse(409, "REFUND_EXCEEDS_PAYMENT", `İade tutarı ödemenin iade edilebilir kısmını (${refundable} TL) aşıyor.`);
  return { ok: true };
}

/** The order may enter the `paid` lifecycle status only when the ledger really holds the full total. */
export function ledgerCoversOrder(total: number, collected: number, refunded: number): boolean {
  return netCollected(collected, refunded) >= total && collected > 0;
}

/** Cancelling while money is still held would leave collected cash with no sale behind it: refund first. */
export function cancellationBlockedByCollection(collected: number, refunded: number): boolean {
  return netCollected(collected, refunded) > 0;
}

// ---- request schemas (route bodies) ---------------------------------------------------------------------------
export const manualPaymentSchema = z.object({
  amount: z.number().int().min(1).max(100_000_000),
  method: z.enum(manualPaymentMethods),
  reference: z.string().trim().max(100).default(""),
  note: z.string().trim().max(500).default(""),
  // When the money was actually received (e.g. yesterday's EFT). Server clock when omitted; never in the future.
  paidAt: z.string().datetime({ offset: true }).optional(),
});
export type ManualPaymentInput = z.infer<typeof manualPaymentSchema>;

export const refundSchema = z.object({
  paymentId: z.string().min(1).max(100),
  amount: z.number().int().min(1).max(100_000_000),
  reason: z.string().trim().min(3).max(500),
});
export type RefundInput = z.infer<typeof refundSchema>;

/** Same Idempotency-Key + same request = replay; same key + anything different = reuse (refused). */
export function samePaymentRequest(existing: { orderId: string; amount: number; method: string | null; reference: string; note: string }, orderId: string, input: ManualPaymentInput): boolean {
  return existing.orderId === orderId && existing.amount === input.amount && existing.method === input.method && existing.reference === input.reference && existing.note === input.note;
}
export function sameRefundRequest(existing: { orderId: string; paymentId: string | null; amount: number; reason: string }, orderId: string, input: RefundInput): boolean {
  return existing.orderId === orderId && existing.paymentId === input.paymentId && existing.amount === input.amount && existing.reason === input.reason;
}

/** Received-at time: the given instant, or now. Refused when in the future or before the order existed. */
export function resolvePaidAt(paidAt: string | undefined, orderCreatedAt: Date, now: Date): { ok: true; at: Date } | { ok: false; refusal: FinanceRefusal } {
  const at = paidAt ? new Date(paidAt) : now;
  if (Number.isNaN(at.getTime())) return refuse(400, "INVALID_PAID_AT", "Ödeme tarihi geçersiz.");
  if (at.getTime() > now.getTime() + 60_000) return refuse(400, "PAID_AT_IN_FUTURE", "Ödeme tarihi gelecekte olamaz.");
  if (at.getTime() < orderCreatedAt.getTime() - 60_000) return refuse(400, "PAID_AT_BEFORE_ORDER", "Ödeme tarihi sipariş tarihinden önce olamaz.");
  return { ok: true, at };
}

// ---- dashboard query -----------------------------------------------------------------------------------------
export const FINANCE_PAGE_SIZE = 25;
export type FinanceFilters = { paymentStatus?: OrderPaymentStatus; orderStatus?: string; method?: PaymentMethod };

export type RawFinanceSummary = {
  orderCount: DbNumeric; cancelledCount: DbNumeric; orderValue: DbNumeric; netOrderValue: DbNumeric; vatTotal: DbNumeric;
  cancelledValue: DbNumeric; collected: DbNumeric; refunded: DbNumeric; outstanding: DbNumeric; unbackedPaidCount: DbNumeric;
};
export type FinanceSummary = {
  orderCount: number; cancelledCount: number;
  /** Sipariş Tutarı: SUM(total) of non-cancelled orders - what customers were asked to pay, never "ciro". */
  orderValue: number; netOrderValue: number; vatTotal: number;
  cancelledValue: number; collected: number; refunded: number; netCollected: number; outstanding: number;
  /** Orders whose stored payment_status says "paid" while no payment record backs it (legacy manual flag). */
  unbackedPaidCount: number;
};

export function buildFinanceSummary(raw: RawFinanceSummary): FinanceSummary {
  const n = (k: keyof RawFinanceSummary) => toSafeNumber(raw[k], k);
  const collected = n("collected"), refunded = n("refunded");
  return {
    orderCount: n("orderCount"), cancelledCount: n("cancelledCount"), orderValue: n("orderValue"), netOrderValue: n("netOrderValue"), vatTotal: n("vatTotal"),
    cancelledValue: n("cancelledValue"), collected, refunded, netCollected: netCollected(collected, refunded), outstanding: n("outstanding"), unbackedPaidCount: n("unbackedPaidCount"),
  };
}

export type FinanceMethodRow = { method: PaymentMethod | "unknown"; paymentCount: number; collected: number; refunded: number };
export type FinanceReportRow = {
  orderId: string; orderNumber: string; createdAt: string; customerName: string;
  total: number; subtotal: number; vatTotal: number; orderStatus: string; paymentStatus: OrderPaymentStatus; storedPaymentStatus: string;
  methods: PaymentMethod[]; collected: number; refunded: number; outstanding: number; returnsCount: number;
};
export type FinanceReport = { summary: FinanceSummary; methods: FinanceMethodRow[]; rows: FinanceReportRow[]; page: number; pageSize: number; pageCount: number; range: { start: string; end: string } };

export const pageCountFor = (total: number, pageSize = FINANCE_PAGE_SIZE) => Math.max(1, Math.ceil(total / pageSize));
