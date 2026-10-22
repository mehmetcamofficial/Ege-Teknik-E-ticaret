import { acceptAdminInvite } from "@/lib/admin-auth";
import { assertSameOrigin, rateLimit } from "@/lib/http-security";
import { validatePasswordPolicy } from "@/lib/password-policy";
import { z } from "zod";

const schema = z.object({ token: z.string().trim().min(20).max(500), password: z.string().min(1).max(200), confirmPassword: z.string().min(1).max(200) });

/**
 * Single-use invitation acceptance. Public by necessity (the invitee has no account yet),
 * so the raw token IS the credential: it is only ever compared as a sha256 hash, never
 * logged, never echoed back. Every failure redirects to the same generic error page, so
 * the response cannot be used to probe which tokens or addresses exist.
 */
export async function POST(request: Request) {
  const fail = () => Response.redirect(new URL("/admin/accept-invite?error=invalid", request.url), 303);
  try {
    assertSameOrigin(request);
    await rateLimit(request, "admin-accept-invite", 10, 15 * 60_000);
    const form = await request.formData();
    const parsed = schema.safeParse({ token: form.get("token"), password: form.get("password"), confirmPassword: form.get("confirmPassword") });
    if (!parsed.success) return fail();
    if (parsed.data.password !== parsed.data.confirmPassword) return Response.redirect(new URL("/admin/accept-invite?error=mismatch", request.url), 303);
    const policy = validatePasswordPolicy(parsed.data.password);
    if (!policy.ok) return Response.redirect(new URL("/admin/accept-invite?error=weak", request.url), 303);

    const result = await acceptAdminInvite(parsed.data.token, parsed.data.password);
    if (!result.ok) return fail();
    return Response.redirect(new URL("/admin/login?invited=1", request.url), 303);
  } catch {
    return fail();
  }
}
