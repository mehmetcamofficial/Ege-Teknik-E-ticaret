import { getAdminUser } from "@/lib/admin-auth";
import { readJson, HttpError } from "@/lib/http-security";
import { hashClientIp } from "@/lib/request-security";
import { moderationRequestSchema } from "@/lib/reviews";
import { moderateReview } from "@/lib/reviews-db";

const failure = { NOT_FOUND: [404, "Yorum bulunamadı."], INVALID_TRANSITION: [409, "Bu durum değişikliğine izin verilmiyor."], STALE: [409, "Yorum bu sırada başka biri tarafından güncellendi; listeyi yenileyin."], CONFLICT: [409, "Aynı sipariş veya içerik için yayında/incelemede başka bir yorum var."] } as const;

/** Moderation only: status + optional note. Review content cannot be edited (DB trigger) and there is no DELETE. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser("content:write");
  if (!admin) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const { id } = await context.params;
  let body: unknown;
  try { body = await readJson(request, 4_000); } catch (error) { return Response.json({ error: error instanceof HttpError ? error.message : "Geçersiz istek." }, { status: error instanceof HttpError ? error.status : 400 }); }
  const parsed = moderationRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Geçersiz moderasyon isteği." }, { status: 400 });
  const result = await moderateReview({ reviewId: id, to: parsed.data.status, note: parsed.data.note, actor: { userId: admin.userId, email: admin.email }, ipHash: await hashClientIp(request) });
  if (!result.ok) { const [status, error] = failure[result.code]; return Response.json({ error, code: result.code }, { status }); }
  return Response.json({ ok: true, status: result.status });
}
