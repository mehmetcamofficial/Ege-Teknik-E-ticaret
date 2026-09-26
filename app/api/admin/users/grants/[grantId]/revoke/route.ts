import { revokeAdminGrant } from "@/lib/admin-auth";
import { assertSameOrigin, HttpError, rateLimit, safeError } from "@/lib/http-security";
import { getAdminUser } from "@/lib/admin-auth";

/** roles:write only. Revocation is a conditional update + audit in one transaction. */
export async function POST(request: Request, context: { params: Promise<{ grantId: string }> }) {
  const admin = await getAdminUser("roles:write");
  if (!admin) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  try {
    assertSameOrigin(request);
    await rateLimit(request, "admin-grant-revoke", 60, 60 * 60_000);
    const { grantId } = await context.params;
    const result = await revokeAdminGrant(grantId, { userId: admin.userId, email: admin.email });
    if (!result.ok) return Response.json({ error: "Geçici yetki bulunamadı veya zaten sona ermiş." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof HttpError) return safeError(error.status, error.message);
    console.error("admin_grant_revoke_error", { name: error instanceof Error ? error.name : "unknown" });
    return safeError();
  }
}
