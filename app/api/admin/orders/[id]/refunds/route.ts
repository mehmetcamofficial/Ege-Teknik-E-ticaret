import { getDb } from "@/db";
import { auditPermissionDenied, effectivePermissions, getAdminUser } from "@/lib/admin-auth";
import { refundSchema, refusalResponse } from "@/lib/finance";
import { recordRefund } from "@/lib/finance-db";
import { HttpError, readJson, safeError } from "@/lib/http-security";
import { idempotencyKey } from "@/lib/request-security";

/**
 * Records a FINANCIAL refund the operator has already paid back outside the site, against one confirmed manual
 * payment. Internal lifecycle only - no provider refund is called. Bounded by what that payment still holds, so the
 * order's refunds can never exceed what was collected. Idempotency-Key required; audited as refund_partial/refund_full.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  // H5-B: money handling is its own permission (payments:refund); ordinary order staff (orders:write) cannot do it.
  const admin = await getAdminUser("admin:read");
  if (!admin) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const permissions = await effectivePermissions(admin.userId, admin.role);
  if (!permissions.includes("payments:refund")) {
    await auditPermissionDenied(admin, "payments:refund", "order", (await context.params).id, { attempt: "refund" });
    return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  }
  try {
    const key = idempotencyKey(request);
    if (!key) return Response.json({ error: "Güvenli istek anahtarı eksik.", code: "IDEMPOTENCY_KEY_REQUIRED" }, { status: 400 });
    const parsed = refundSchema.safeParse(await readJson(request, 4_000));
    if (!parsed.success) return Response.json({ error: "İade bilgilerini kontrol edin (tutar ve en az 3 karakterlik gerekçe).", code: "INVALID_REFUND" }, { status: 400 });
    const { id } = await context.params;
    const result = await recordRefund(getDb(), { orderId: id, body: parsed.data, actor: { userId: admin.userId, email: admin.email, permissions }, idempotencyKey: key });
    if (!result.ok) return refusalResponse(result.refusal);
    return Response.json({ ok: true, refundId: result.refundId, paymentStatus: result.paymentStatus, replayed: result.replayed }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof HttpError) return safeError(error.status, error.message);
    throw error;
  }
}
