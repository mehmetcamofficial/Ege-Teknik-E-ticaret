import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db";
import { resendProvider } from "@/lib/notifications/provider";
import { runNotificationWorker } from "@/lib/notifications/outbox";

export const dynamic = "force-dynamic";

/**
 * H5-A worker trigger (Vercel Cron style: GET + `Authorization: Bearer <NOTIFICATION_DISPATCH_SECRET>`).
 * Not a public or admin route: without the secret it answers 404 (feature absent) or 401. It returns counts only -
 * never a recipient, subject, body or order data. It runs AFTER orders are committed and is safe to call repeatedly.
 */
export async function GET(request: Request) {
  const secret = process.env.NOTIFICATION_DISPATCH_SECRET?.trim();
  if (!secret || secret.length < 32) return Response.json({ error: "not_configured" }, { status: 404, headers: { "cache-control": "no-store" } });
  const presented = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  const a = Buffer.from(presented), b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  const result = await runNotificationWorker({ db: getDb(), provider: resendProvider(process.env), env: process.env });
  return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
}
