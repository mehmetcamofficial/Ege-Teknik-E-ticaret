import { requestPasswordReset } from "@/lib/admin-auth";
import { HttpError, assertSameOrigin, rateLimit } from "@/lib/http-security";
import { z } from "zod";

const schema = z.object({ email: z.string().trim().email().max(254).transform((x) => x.toLowerCase()) });

/**
 * Enumeration-safe by construction: every code path below - unknown e-mail, inactive admin, mail
 * provider not configured, delivery failure, or a genuine send - ends at the exact same redirect.
 * requestPasswordReset()'s more detailed outcome exists only for server-side visibility (logs/
 * tests), never for this response.
 */
export async function POST(request: Request) {
  const sent = () => Response.redirect(new URL("/admin/forgot-password?sent=1", request.url), 303);
  try {
    assertSameOrigin(request);
    await rateLimit(request, "admin-forgot-password", 5, 15 * 60_000);
    const form = await request.formData();
    const parsed = schema.safeParse({ email: form.get("email") });
    if (!parsed.success) return sent();
    const outcome = await requestPasswordReset(parsed.data.email, request);
    if (outcome.status === "send_failed" || outcome.status === "email_not_configured") console.error("admin_forgot_password_mail_issue", { status: outcome.status });
    return sent();
  } catch (error) {
    if (error instanceof HttpError) return Response.redirect(new URL(`/admin/forgot-password?error=${error.status}`, request.url), 303);
    console.error("admin_forgot_password_error", { name: error instanceof Error ? error.name : "unknown" });
    return sent();
  }
}
