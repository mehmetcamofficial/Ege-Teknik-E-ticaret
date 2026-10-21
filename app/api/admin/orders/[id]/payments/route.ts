import { getDb } from "@/db";
import { getAdminUser } from "@/lib/admin-auth";
import { manualPaymentSchema, refusalResponse } from "@/lib/finance";
import { loadOrderLedger, recordManualPayment } from "@/lib/finance-db";
import { HttpError, readJson, safeError } from "@/lib/http-security";
import { idempotencyKey } from "@/lib/request-security";

/** One order's payment ledger (payments + refunds + derived amounts). Read access matches the order list: admin:read. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser("admin:read");
  if (!admin) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const { id } = await context.params;
  const ledger = await loadOrderLedger(getDb(), id);
  if (!ledger) return Response.json({ error: "Sipariş bulunamadı." }, { status: 404 });
  return Response.json(ledger, { headers: { "cache-control": "no-store" } });
}

/**
 * Records money an operator actually received outside the site (cash, EFT/havale, physical POS). No provider call,
 * no online method: those will only ever come from a provider integration. The amount is bounded server-side by the
 * order's outstanding balance; an Idempotency-Key header is mandatory so a double click records one payment.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser("orders:write");
  if (!admin) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  try {
    const key = idempotencyKey(request);
    if (!key) return Response.json({ error: "Güvenli istek anahtarı eksik.", code: "IDEMPOTENCY_KEY_REQUIRED" }, { status: 400 });
    const parsed = manualPaymentSchema.safeParse(await readJson(request, 4_000));
    if (!parsed.success) return Response.json({ error: "Ödeme bilgilerini kontrol edin.", code: "INVALID_PAYMENT" }, { status: 400 });
    const { id } = await context.params;
    const result = await recordManualPayment(getDb(), { orderId: id, body: parsed.data, actor: { userId: admin.userId, email: admin.email }, idempotencyKey: key });
    if (!result.ok) return refusalResponse(result.refusal);
    return Response.json({ ok: true, paymentId: result.paymentId, paymentStatus: result.paymentStatus, replayed: result.replayed }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof HttpError) return safeError(error.status, error.message);
    throw error;
  }
}
