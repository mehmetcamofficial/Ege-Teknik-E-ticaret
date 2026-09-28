import { createHash, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { orderItems, orders, payments } from "../db/schema.ts";
import { audit, ledgerSums, type FinanceActor, type FinanceDb } from "./finance-db.ts";
import { derivePaymentStatus, ledgerCoversOrder, outstandingAmount } from "./finance.ts";
import {
  PAYTR_IFRAME_BASE, PAYTR_PROVIDER, PAYTR_TIMEOUT_MINUTES, PAYTR_TOKEN_URL, buildTokenRequest, isMerchantOid, mapPaytrStatus, newMerchantOid,
  resultUrl, sanitizeProviderText, tlToKurus, verifyPaytrCallbackHash, type BasketLine, type PaytrCallback, type PaytrConfig, type PaytrConfigResult,
} from "./paytr.ts";

/**
 * PayTR persistence (Phase 3.3B prep). Same conventions as lib/finance-db.ts: the database is a parameter, writes lock
 * the order row, audit rows go to audit_logs through the same secret guard. Network access is injected (fetchImpl) so
 * tests never reach PayTR; with PAYTR_ENABLED unset nothing here is reachable at all.
 *
 * SOURCE OF TRUTH: only a hash-verified callback moves a PayTR payment to 'paid'. The customer landing on the success
 * URL proves nothing and changes nothing.
 */

const SYSTEM_ACTOR: FinanceActor = { userId: "system:paytr", email: "paytr-callback@system" };
const CHECKOUT_ACTOR: FinanceActor = { userId: "system:checkout", email: "customer-checkout@system" };
const IN_FLIGHT_MS = 60_000;
type Refusal = { ok: false; status: number; code: string; error: string };
const refuse = (status: number, code: string, error: string): Refusal => ({ ok: false, status, code, error });
type Meta = Record<string, unknown>;
const meta = (value: unknown): Meta => (value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Meta) } : {});

const DISABLED_MESSAGE = "Online ödeme şu anda kullanılamıyor. Siparişiniz kayıtlıdır; ödeme için sizinle iletişime geçeceğiz.";
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
const sameEmail = (a: string, b: string) => timingSafeEqual(digest(a.trim().toLocaleLowerCase("tr")), digest(b.trim().toLocaleLowerCase("tr")));

// ---- payment attempt / iframe token --------------------------------------------------------------------------------
export type StartPaymentResult = Refusal | { ok: true; token: string; iframeUrl: string; merchantOid: string; reused: boolean };

/**
 * Starts (or resumes) an online payment for an order the caller proves to know (order number + e-mail on the order).
 * The amount is the order's outstanding balance from the database - the client sends no amount at all.
 */
export async function startPaytrPayment(db: FinanceDb, input: {
  config: PaytrConfigResult; orderNumber: string; email: string; userIp: string; now?: Date;
  fetchImpl?: typeof fetch; random?: (n: number) => Buffer;
}): Promise<StartPaymentResult> {
  if (input.config.state !== "enabled") return refuse(503, input.config.state === "disabled" ? "PAYMENT_PROVIDER_DISABLED" : "PAYMENT_PROVIDER_UNAVAILABLE", DISABLED_MESSAGE);
  const config: PaytrConfig = input.config.config;
  const now = input.now ?? new Date();

  const prepared = await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.orderNumber, input.orderNumber)).for("update").limit(1);
    if (!order || !order.email || !sameEmail(order.email, input.email)) return refuse(404, "ORDER_NOT_FOUND", "Sipariş bilgileri doğrulanamadı. Sipariş numarası ve e-posta adresini kontrol edin.");
    if (order.status === "cancelled" || order.status === "returned") return refuse(409, "ORDER_NOT_PAYABLE", "Bu sipariş için ödeme alınamaz.");
    const { collected } = await ledgerSums(tx, order.id);
    const due = outstandingAmount(order.total, collected);
    if (due <= 0) return refuse(409, "ALREADY_PAID", "Bu siparişin ödemesi zaten alınmış.");

    const pending = await tx.select().from(payments).where(and(eq(payments.orderId, order.id), eq(payments.provider, PAYTR_PROVIDER), eq(payments.status, "pending"))).orderBy(desc(payments.createdAt));
    for (const attempt of pending) {
      const m = meta(attempt.metadata);
      const liveToken = typeof m.iframeToken === "string" && typeof m.tokenExpiresAt === "string" && new Date(m.tokenExpiresAt).getTime() > now.getTime() + 60_000;
      if (liveToken && attempt.amount === due) return { reuse: { token: m.iframeToken as string, merchantOid: attempt.providerTransactionId! } };
      if (!m.iframeToken && !m.failureCode && now.getTime() - attempt.createdAt.getTime() < IN_FLIGHT_MS) return refuse(409, "ATTEMPT_IN_PROGRESS", "Ödeme başlatılıyor, lütfen birkaç saniye sonra tekrar deneyin.");
    }
    // Older unpaid attempts are superseded, never deleted: a late success callback for one still records the money.
    for (const attempt of pending) {
      await tx.update(payments).set({ status: "cancelled", metadata: { ...meta(attempt.metadata), failureCode: "SUPERSEDED" }, updatedAt: now }).where(eq(payments.id, attempt.id));
    }
    const merchantOid = newMerchantOid(order.orderNumber, input.random);
    const paymentId = crypto.randomUUID();
    await tx.insert(payments).values({ id: paymentId, orderId: order.id, provider: PAYTR_PROVIDER, providerTransactionId: merchantOid, amount: due, currency: "TRY", status: "pending", method: "online", metadata: { testMode: config.testMode } });
    await audit(tx, CHECKOUT_ACTOR, "paytr_payment_attempt_created", "order", order.id, { paymentId, merchantOid, amount: due, testMode: config.testMode, superseded: pending.length });
    const lines = await tx.select({ name: orderItems.productName, unitPrice: orderItems.unitPrice, quantity: orderItems.quantity }).from(orderItems).where(eq(orderItems.orderId, order.id)).orderBy(asc(orderItems.createdAt));
    // An itemised basket only when it sums to the charged amount; a partial balance goes as one clearly named line.
    const basket: BasketLine[] = due === order.total
      ? [...lines.map((l) => ({ name: l.name, unitPriceKurus: tlToKurus(l.unitPrice), quantity: l.quantity })), ...(order.shippingTotal > 0 ? [{ name: "Kargo", unitPriceKurus: tlToKurus(order.shippingTotal), quantity: 1 }] : [])]
      : [{ name: `Sipariş ${order.orderNumber} kalan bakiye`, unitPriceKurus: tlToKurus(due), quantity: 1 }];
    return { create: { paymentId, merchantOid, due, basket, order: { email: order.email, name: order.customerName, phone: order.phone, address: `${order.address} ${order.city}`.trim() } } };
  });

  if ("ok" in prepared) return prepared;
  if (prepared.reuse) return { ok: true, token: prepared.reuse.token, iframeUrl: PAYTR_IFRAME_BASE + prepared.reuse.token, merchantOid: prepared.reuse.merchantOid, reused: true };
  if (!prepared.create) return refuse(500, "INTERNAL", "İşlem tamamlanamadı.");

  const { paymentId, merchantOid, due, basket, order } = prepared.create;
  const body = buildTokenRequest(config, {
    merchantOid, userIp: input.userIp, email: order.email, paymentAmountKurus: tlToKurus(due), basket,
    userName: order.name, userAddress: order.address, userPhone: order.phone, okUrl: resultUrl(config.okUrl, merchantOid), failUrl: resultUrl(config.failUrl, merchantOid),
  });
  let outcome: { token: string } | { failure: string };
  try {
    const response = await (input.fetchImpl ?? fetch)(PAYTR_TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString(), signal: AbortSignal.timeout(10_000) });
    const json = (await response.json().catch(() => ({}))) as { status?: string; token?: string; reason?: string };
    outcome = json.status === "success" && typeof json.token === "string" && /^[A-Za-z0-9]{8,200}$/.test(json.token) ? { token: json.token } : { failure: sanitizeProviderText(json.reason ?? `HTTP ${response.status}`) };
  } catch (error) {
    outcome = { failure: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network_error" };
  }
  const expiresAt = new Date(now.getTime() + PAYTR_TIMEOUT_MINUTES * 60_000).toISOString();
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ metadata: payments.metadata, status: payments.status }).from(payments).where(eq(payments.id, paymentId)).for("update").limit(1);
    if (!row || row.status !== "pending") return;
    const m = meta(row.metadata);
    if ("token" in outcome) await tx.update(payments).set({ metadata: { ...m, iframeToken: outcome.token, tokenExpiresAt: expiresAt }, updatedAt: new Date() }).where(eq(payments.id, paymentId));
    else await tx.update(payments).set({ status: "failed", metadata: { ...m, failureCode: "TOKEN_REQUEST_FAILED", failureMessage: outcome.failure }, updatedAt: new Date() }).where(eq(payments.id, paymentId));
  });
  if ("failure" in outcome) return refuse(502, "PAYMENT_PROVIDER_ERROR", "Ödeme sayfası şu anda açılamadı. Lütfen biraz sonra tekrar deneyin; siparişiniz kayıtlıdır.");
  return { ok: true, token: outcome.token, iframeUrl: PAYTR_IFRAME_BASE + outcome.token, merchantOid, reused: false };
}

// ---- callback ------------------------------------------------------------------------------------------------------
export type CallbackOutcome = { httpStatus: number; body: string; result: "invalid_hash" | "invalid_status" | "unknown_reference" | "paid" | "already_paid" | "amount_mismatch" | "failed" | "ignored_failure" };
const ok = (result: CallbackOutcome["result"]): CallbackOutcome => ({ httpStatus: 200, body: "OK", result });

/**
 * Server-to-server notification. The hash is verified before anything is read from the database; an invalid hash
 * changes nothing. Every state change happens once: a repeated callback finds the attempt already final and writes
 * nothing (no second payment, no second audit, no stock effect - stock was reserved when the order was created).
 */
export async function processPaytrCallback(db: FinanceDb, input: { config: PaytrConfig; callback: PaytrCallback; now?: Date }): Promise<CallbackOutcome> {
  const { config, callback: cb } = input;
  const now = input.now ?? new Date();
  const reference = isMerchantOid(cb.merchantOid) ? cb.merchantOid : "invalid";
  if (!verifyPaytrCallbackHash({ merchantOid: cb.merchantOid, status: cb.status, totalAmount: cb.totalAmount, hash: cb.hash }, config)) {
    await db.transaction((tx) => audit(tx, SYSTEM_ACTOR, "paytr_invalid_callback", "payment_callback", reference, { reason: "bad_hash", status: sanitizeProviderText(cb.status, 20) }));
    return { httpStatus: 400, body: "PAYTR notification failed: bad hash", result: "invalid_hash" };
  }
  const mapped = mapPaytrStatus(cb.status);
  if (!mapped || !isMerchantOid(cb.merchantOid)) {
    await db.transaction((tx) => audit(tx, SYSTEM_ACTOR, "paytr_invalid_callback", "payment_callback", reference, { reason: "invalid_status_or_reference", status: sanitizeProviderText(cb.status, 20) }));
    return { httpStatus: 400, body: "PAYTR notification failed: invalid payload", result: "invalid_status" };
  }

  return db.transaction(async (tx) => {
    const [found] = await tx.select({ id: payments.id, orderId: payments.orderId }).from(payments).where(and(eq(payments.provider, PAYTR_PROVIDER), eq(payments.providerTransactionId, cb.merchantOid))).limit(1);
    if (!found) {
      await audit(tx, SYSTEM_ACTOR, "paytr_callback_unknown_reference", "payment_callback", cb.merchantOid, { status: mapped });
      return ok("unknown_reference");
    }
    // Lock order before payment - the same order every finance write uses - so callbacks and admin actions serialize.
    const [order] = await tx.select({ id: orders.id, status: orders.status, total: orders.total, paymentStatus: orders.paymentStatus }).from(orders).where(eq(orders.id, found.orderId)).for("update").limit(1);
    const [payment] = await tx.select().from(payments).where(eq(payments.id, found.id)).for("update").limit(1);
    if (!order || !payment) return ok("unknown_reference");
    const m = meta(payment.metadata);

    if (mapped === "failed") {
      // A failure never overrides a confirmed payment, and a repeated failure writes nothing.
      if (payment.status === "paid" || payment.status === "failed") return ok("ignored_failure");
      await tx.update(payments).set({ status: "failed", metadata: { ...m, failureCode: sanitizeProviderText(cb.failedReasonCode, 20) || "FAILED", failureMessage: sanitizeProviderText(cb.failedReasonMsg), callbackAt: now.toISOString() }, updatedAt: now }).where(eq(payments.id, payment.id));
      await audit(tx, SYSTEM_ACTOR, "paytr_callback_failed", "order", order.id, { paymentId: payment.id, merchantOid: cb.merchantOid, failureCode: sanitizeProviderText(cb.failedReasonCode, 20) || "FAILED" });
      return ok("failed");
    }

    if (payment.status === "paid") return ok("already_paid");
    const expectedKurus = String(tlToKurus(payment.amount));
    const currencyOk = !cb.currency || cb.currency === "TL" || cb.currency === "TRY";
    if (cb.paymentAmount !== expectedKurus || !currencyOk) {
      // Money may have moved but not the amount we asked for: never counted as collected; flagged once for review.
      if (m.failureCode !== "AMOUNT_MISMATCH") {
        await tx.update(payments).set({ metadata: { ...m, failureCode: "AMOUNT_MISMATCH", reviewRequired: true, receivedAmountKurus: sanitizeProviderText(cb.paymentAmount, 20), receivedCurrency: sanitizeProviderText(cb.currency, 5), callbackAt: now.toISOString() }, updatedAt: now }).where(eq(payments.id, payment.id));
        await audit(tx, SYSTEM_ACTOR, "paytr_callback_amount_mismatch", "order", order.id, { paymentId: payment.id, merchantOid: cb.merchantOid, expectedKurus, receivedKurus: sanitizeProviderText(cb.paymentAmount, 20) });
      }
      return ok("amount_mismatch");
    }

    const before = await ledgerSums(tx, order.id);
    const collectedAfter = before.collected + payment.amount;
    const overCollected = collectedAfter > order.total;
    await tx.update(payments).set({
      status: "paid", paidAt: now, updatedAt: now,
      metadata: { ...m, failureCode: null, callbackAt: now.toISOString(), paymentType: sanitizeProviderText(cb.paymentType, 20), providerTestMode: cb.testMode === "1", totalAmountKurus: sanitizeProviderText(cb.totalAmount, 20), ...(overCollected ? { reviewRequired: true } : {}) },
    }).where(eq(payments.id, payment.id));
    const nextPayment = derivePaymentStatus({ total: order.total, orderStatus: order.status, collected: collectedAfter, refunded: before.refunded });
    const advance = order.status === "pending_payment" && ledgerCoversOrder(order.total, collectedAfter, before.refunded);
    await tx.update(orders).set({ paymentStatus: nextPayment, ...(advance ? { status: "paid" } : {}), updatedAt: now }).where(eq(orders.id, order.id));
    await audit(tx, SYSTEM_ACTOR, "paytr_callback_success", "order", order.id, { paymentId: payment.id, merchantOid: cb.merchantOid, amountKurus: expectedKurus, paymentType: sanitizeProviderText(cb.paymentType, 20), providerTestMode: cb.testMode === "1" });
    await audit(tx, SYSTEM_ACTOR, "payment_paid", "order", order.id, {
      paymentId: payment.id, amount: payment.amount, method: "online", provider: PAYTR_PROVIDER, previousAttemptStatus: payment.status,
      paymentStatus: { from: order.paymentStatus, to: nextPayment }, collected: { from: before.collected, to: collectedAfter },
      ...(advance ? { orderStatus: { from: order.status, to: "paid" } } : {}), ...(overCollected ? { overCollected: true } : {}),
    });
    return ok("paid");
  });
}

// ---- result page ---------------------------------------------------------------------------------------------------
/** What the success/fail page may show for an attempt reference: order number and the real, callback-driven state. */
export async function loadPaytrAttempt(db: FinanceDb, merchantOid: string): Promise<{ orderNumber: string; status: string } | null> {
  if (!isMerchantOid(merchantOid)) return null;
  const [row] = await db.select({ orderNumber: orders.orderNumber, status: payments.status }).from(payments).innerJoin(orders, eq(orders.id, payments.orderId))
    .where(and(eq(payments.provider, PAYTR_PROVIDER), eq(payments.providerTransactionId, merchantOid))).limit(1);
  return row ?? null;
}

