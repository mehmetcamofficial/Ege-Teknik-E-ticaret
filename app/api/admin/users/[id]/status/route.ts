import { deactivateAdminUser, reactivateAdminUser } from "@/lib/admin-auth";
import { assertSameOrigin, HttpError, rateLimit, readJson, safeError } from "@/lib/http-security";
import { getAdminUser } from "@/lib/admin-auth";
import { z } from "zod";

// confirm:true forces the UI's explicit confirmation; a scripted call cannot skip it.
const schema = z.object({ active: z.boolean(), confirm: z.literal(true) });

const failures = {
  NOT_FOUND: [404, "Kullanıcı bulunamadı."],
  LAST_SUPER_ADMIN: [409, "Son aktif Süper Yönetici devre dışı bırakılamaz veya rolü düşürülemez."],
  RETIRED_ROLE: [409, "Legacy sahip hesabı doğrudan etkinleştirilemez; önce izinli bir role dönüştürün."],
} as const;

/**
 * users:write only. Deactivation revokes every live session in the same transaction
 * as the audit write; the last active super_admin is refused (final recovery authority).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser("users:write");
  if (!admin) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  try {
    assertSameOrigin(request);
    await rateLimit(request, "admin-user-status", 30, 60 * 60_000);
    const { id } = await context.params;
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) return Response.json({ error: "Onay alanı zorunludur." }, { status: 400 });
    const result = parsed.data.active
      ? await reactivateAdminUser(id, { userId: admin.userId, email: admin.email })
      : await deactivateAdminUser(id, { userId: admin.userId, email: admin.email });
    if (!result.ok) {
      const [status, error] = failures[result.code];
      return Response.json({ error, code: result.code }, { status });
    }
    return Response.json({ ok: true, active: parsed.data.active });
  } catch (error) {
    if (error instanceof HttpError) return safeError(error.status, error.message);
    console.error("admin_user_status_error", { name: error instanceof Error ? error.name : "unknown" });
    return safeError();
  }
}
