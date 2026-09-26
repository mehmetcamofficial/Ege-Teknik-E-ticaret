import { changeAdminRole } from "@/lib/admin-auth";
import { assertSameOrigin, HttpError, rateLimit, readJson, safeError } from "@/lib/http-security";
import { getAdminUser } from "@/lib/admin-auth";
import { isAssignableRole } from "@/lib/privileged-admin-db";
import type { AdminRole } from "@/lib/security-policy";
import { z } from "zod";

const schema = z.object({ role: z.string().min(1).max(40), confirm: z.literal(true) });

const failures = {
  NOT_FOUND: [404, "Kullanıcı bulunamadı."],
  LAST_SUPER_ADMIN: [409, "Son aktif Süper Yönetici rolü düşürülemez."],
  RETIRED_ROLE: [400, "Legacy sahip rolü artık atanamaz."],
} as const;

/**
 * roles:write only. Demotion of a privileged role revokes live sessions in the same
 * transaction as the audit write; the last active super_admin is refused. The retired
 * "owner" role is rejected here and again by the DB trigger.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser("roles:write");
  if (!admin) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  try {
    assertSameOrigin(request);
    await rateLimit(request, "admin-user-role", 30, 60 * 60_000);
    const { id } = await context.params;
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) return Response.json({ error: "Onay alanı zorunludur." }, { status: 400 });
    if (!isAssignableRole(parsed.data.role)) return Response.json({ error: "Bu rol atanamaz.", code: "RETIRED_ROLE" }, { status: 400 });
    const result = await changeAdminRole(id, parsed.data.role as AdminRole, { userId: admin.userId, email: admin.email });
    if (!result.ok) {
      const [status, error] = failures[result.code];
      return Response.json({ error, code: result.code }, { status });
    }
    return Response.json({ ok: true, role: parsed.data.role });
  } catch (error) {
    if (error instanceof HttpError) return safeError(error.status, error.message);
    console.error("admin_user_role_error", { name: error instanceof Error ? error.name : "unknown" });
    return safeError();
  }
}
