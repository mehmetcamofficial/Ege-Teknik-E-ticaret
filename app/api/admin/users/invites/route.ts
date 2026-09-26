import { createAdminInvite, getAdminUser } from "@/lib/admin-auth";
import { assertSameOrigin, rateLimit, readJson } from "@/lib/http-security";
import { inviteTtlError, isInvitableRole, listPendingInvites } from "@/lib/privileged-admin-db";
import { z } from "zod";

const schema = z.object({
  email: z.string().trim().email().max(254),
  role: z.string().min(1).max(40),
  ttlHours: z.coerce.number().int(),
});

/**
 * Pending invitations (users:read). Metadata only: no token hash, no raw token,
 * no link - the recipient link exists solely in the delivered e-mail.
 */
export async function GET() {
  const admin = await getAdminUser("users:read");
  if (!admin) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  return Response.json({ invites: await listPendingInvites() }, { headers: { "cache-control": "no-store" } });
}

/**
 * users:write only. The raw invite token is emailed via Resend and NEVER
 * returned in this response - only metadata (invite id, recipient, expiry).
 */
export async function POST(request: Request) {
  const admin = await getAdminUser("users:write");
  if (!admin) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  try {
    assertSameOrigin(request);
    await rateLimit(request, "admin-user-invite", 10, 60 * 60_000);
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) return Response.json({ error: "Davet bilgilerini kontrol edin." }, { status: 400 });
    if (!isInvitableRole(parsed.data.role)) return Response.json({ error: "Bu rol davet edilemez." }, { status: 400 });
    const ttlError = inviteTtlError(parsed.data.ttlHours);
    if (ttlError) return Response.json({ error: ttlError }, { status: 400 });
    const result = await createAdminInvite(
      { email: parsed.data.email, role: parsed.data.role as never, ttlHours: parsed.data.ttlHours },
      { userId: admin.userId, email: admin.email },
      request
    );
    if (!result.ok) {
      const message = result.code === "RETIRED_ROLE" ? "Bu rol davet edilemez." : result.code === "TTL_EXCEEDED" ? "Davet süresi en fazla 72 saat olabilir." : "Davet e-postası gönderilemedi.";
      return Response.json({ error: message }, { status: result.code === "MAIL_FAILED" ? 502 : 400 });
    }
    return Response.json({ ok: true, inviteId: result.inviteId }, { status: 201 });
  } catch (error) {
    const { HttpError } = await import("@/lib/http-security");
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}