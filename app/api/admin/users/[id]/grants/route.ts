import { createAdminGrant } from "@/lib/admin-auth";
import { assertSameOrigin, HttpError, rateLimit, readJson, safeError } from "@/lib/http-security";
import { getAdminUser } from "@/lib/admin-auth";
import { grantTtlError, isKnownPermission } from "@/lib/privileged-admin-db";
import { z } from "zod";

const schema = z.object({ permission: z.string().min(1).max(40), ttlHours: z.coerce.number().int(), reason: z.string().max(200).default("") });

/**
 * roles:write only. Time-boxed access: the TTL ceiling is per permission
 * (privileged <= 24 HOURS, operational <= 168 HOURS) and payments:configure is
 * ungrantable entirely - it stays Super-Admin-only.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser("roles:write");
  if (!admin) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  try {
    assertSameOrigin(request);
    await rateLimit(request, "admin-user-grant", 30, 60 * 60_000);
    const { id } = await context.params;
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) return Response.json({ error: "Geçici yetki bilgilerini kontrol edin." }, { status: 400 });
    if (!isKnownPermission(parsed.data.permission)) return Response.json({ error: "Bilinmeyen yetki." }, { status: 400 });
    const ttlError = grantTtlError(parsed.data.permission, parsed.data.ttlHours);
    if (ttlError) return Response.json({ error: ttlError, code: "TTL_EXCEEDED" }, { status: 400 });
    const result = await createAdminGrant(
      { adminUserId: id, permission: parsed.data.permission, ttlHours: parsed.data.ttlHours, reason: parsed.data.reason },
      { userId: admin.userId, email: admin.email }
    );
    if (!result.ok) {
      const [status, error] = result.code === "UNGRANTABLE"
        ? [400, "Bu yetki süreli olarak verilemez (yalnızca kalıcı rol ile taşınır)."] as const
        : [400, "Süre sınırı aşıldı."] as const;
      return Response.json({ error, code: result.code }, { status });
    }
    return Response.json({ ok: true, grantId: result.grantId }, { status: 201 });
  } catch (error) {
    if (error instanceof HttpError) return safeError(error.status, error.message);
    console.error("admin_user_grant_error", { name: error instanceof Error ? error.name : "unknown" });
    return safeError();
  }
}
