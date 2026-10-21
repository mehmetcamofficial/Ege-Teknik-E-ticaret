import { consumePasswordResetToken } from "@/lib/admin-auth";
import { HttpError, assertSameOrigin, rateLimit } from "@/lib/http-security";
import { hashPassword } from "@/lib/password";
import { validatePasswordPolicy } from "@/lib/password-policy";
import { z } from "zod";

const schema = z.object({ token: z.string().trim().min(20).max(500), password: z.string().min(1).max(200), confirmPassword: z.string().min(1).max(200) });

/**
 * Token validity and password-strength failures get distinct redirects (both are legitimate,
 * actionable UX feedback that reveals nothing about any OTHER account) - only e-mail existence
 * is enumeration-sensitive, and that decision already happened upstream in /forgot-password.
 */
export async function POST(request: Request) {
  const back = (token: string, error: string) => Response.redirect(new URL(`/admin/reset-password?token=${encodeURIComponent(token)}&error=${error}`, request.url), 303);
  try {
    assertSameOrigin(request);
    await rateLimit(request, "admin-reset-password", 10, 15 * 60_000);
    const form = await request.formData();
    const parsed = schema.safeParse({ token: form.get("token"), password: form.get("password"), confirmPassword: form.get("confirmPassword") });
    if (!parsed.success) return Response.redirect(new URL("/admin/reset-password?error=invalid", request.url), 303);
    if (parsed.data.password !== parsed.data.confirmPassword) return back(parsed.data.token, "mismatch");

    const policy = validatePasswordPolicy(parsed.data.password);
    if (!policy.ok) return back(parsed.data.token, "weak");

    const passwordHash = await hashPassword(parsed.data.password);
    const outcome = await consumePasswordResetToken(parsed.data.token, passwordHash);
    if (!outcome.ok) return Response.redirect(new URL("/admin/reset-password?error=invalid", request.url), 303);

    return Response.redirect(new URL("/admin/login?reset=1", request.url), 303);
  } catch (error) {
    if (error instanceof HttpError) return Response.redirect(new URL(`/admin/reset-password?error=${error.status}`, request.url), 303);
    console.error("admin_reset_password_error", { name: error instanceof Error ? error.name : "unknown" });
    return Response.redirect(new URL("/admin/reset-password?error=invalid", request.url), 303);
  }
}
