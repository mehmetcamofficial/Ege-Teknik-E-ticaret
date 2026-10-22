/**
 * H5-A: outbound e-mail provider boundary for ORDER notifications. Separate from lib/mail.ts (admin invitations).
 * Injectable: production code builds the Resend provider from the environment; tests pass a fake. This module never
 * logs a recipient, subject or body, and never throws for a provider failure: it classifies it.
 */
export type ProviderMessage = { to: string[]; subject: string; text: string; html: string; idempotencyKey: string };
export type ProviderResult =
  | { ok: true }
  | { ok: false; retryable: boolean; code: "send_failed" | "timeout" | "rate_limited" | "provider_5xx" | "rejected" | "invalid_recipient" };
export interface NotificationProvider { send(message: ProviderMessage): Promise<ProviderResult> }

export type ProviderStatus = { configured: boolean; provider: "resend" | "none"; reason?: "RESEND_API_KEY_missing" | "MAIL_FROM_missing" };
export function providerStatus(env: Record<string, string | undefined>): ProviderStatus {
  if (!env.RESEND_API_KEY?.trim()) return { configured: false, provider: "none", reason: "RESEND_API_KEY_missing" };
  if (!env.MAIL_FROM?.trim()) return { configured: false, provider: "none", reason: "MAIL_FROM_missing" };
  return { configured: true, provider: "resend" };
}

/** The base URL may be overridden ONLY outside production (the disposable HTTP tests point it at a loopback mock). */
export function resendBase(env: Record<string, string | undefined>): string {
  const override = env.RESEND_API_BASE?.trim();
  if (override && env.APP_ENV !== "production" && /^http:\/\/127\.0\.0\.1:\d+$/.test(override)) return override;
  return "https://api.resend.com";
}

export function resendProvider(env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch): NotificationProvider | null {
  if (!providerStatus(env).configured) return null;
  const apiKey = env.RESEND_API_KEY!.trim(), from = env.MAIL_FROM!.trim(), base = resendBase(env);
  return {
    async send(m) {
      try {
        const res = await fetchImpl(`${base}/emails`, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": m.idempotencyKey },
          body: JSON.stringify({ from, to: m.to, subject: m.subject, text: m.text, html: m.html }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) return { ok: true };
        if (res.status === 429) return { ok: false, retryable: true, code: "rate_limited" };
        if (res.status >= 500) return { ok: false, retryable: true, code: "provider_5xx" };
        if (res.status === 422) return { ok: false, retryable: false, code: "invalid_recipient" };
        return { ok: false, retryable: false, code: "rejected" };
      } catch (error) {
        return { ok: false, retryable: true, code: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "send_failed" };
      }
    },
  };
}
