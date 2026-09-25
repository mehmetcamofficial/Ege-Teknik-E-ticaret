import "server-only";

/**
 * Outbound transactional e-mail (Phase 6B - currently only the admin password-reset link).
 * Sends via Resend when RESEND_API_KEY and MAIL_FROM are both set; otherwise reports
 * "not_configured" rather than pretending to have sent anything. Callers (see
 * app/api/auth/forgot-password/route.ts) must never let the caller-visible response depend on
 * this result - the outcome is send-and-forget from the requester's point of view, both for
 * enumeration-safety and because a delivery failure should never surface as an application error.
 */
export type MailResult = { ok: true } | { ok: false; reason: "not_configured" | "send_failed" };

export async function sendMail(input: { to: string; subject: string; text: string }): Promise<MailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!apiKey || !from) return { ok: false, reason: "not_configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: input.to, subject: input.subject, text: input.text }),
    });
    return res.ok ? { ok: true } : { ok: false, reason: "send_failed" };
  } catch {
    return { ok: false, reason: "send_failed" };
  }
}
