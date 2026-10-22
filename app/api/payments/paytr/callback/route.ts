import { getDb } from "@/db";
import { HttpError, rateLimit } from "@/lib/http-security";
import { parsePaytrCallback, readPaytrConfig } from "@/lib/paytr";
import { processPaytrCallback } from "@/lib/paytr-db";

const text = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/**
 * PayTR server-to-server notification (Bildirim URL). No browser session and no Origin check (exempted by exact path
 * in lib/security-policy.ts); authenticity is the HMAC hash, verified before any state is read or written. "OK" tells
 * PayTR the notification was processed; any other answer makes PayTR retry. Never logs the payload or a secret.
 */
export async function POST(request: Request) {
  const config = readPaytrConfig(process.env);
  if (config.state !== "enabled") return text("PAYTR notification failed: provider disabled", 503);
  try {
    await rateLimit(request, "paytr-callback", 300, 60_000);
    const raw = await request.text();
    if (raw.length > 16_000) return text("PAYTR notification failed: payload too large", 413);
    const outcome = await processPaytrCallback(getDb(), { config: config.config, callback: parsePaytrCallback(new URLSearchParams(raw)) });
    return text(outcome.body, outcome.httpStatus);
  } catch (error) {
    if (error instanceof HttpError) return text("PAYTR notification failed", error.status);
    console.error("paytr_callback_error", { name: error instanceof Error ? error.name : "unknown" });
    return text("PAYTR notification failed", 500);
  }
}
