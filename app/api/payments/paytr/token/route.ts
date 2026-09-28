import { getDb } from "@/db";
import { clientIp } from "@/lib/admin-auth";
import { publicRoute, rateLimit, readJson } from "@/lib/http-security";
import { readPaytrConfig } from "@/lib/paytr";
import { startPaytrPayment } from "@/lib/paytr-db";
import { z } from "zod";

const startBody = z.object({ orderNumber: z.string().trim().min(4).max(40), email: z.string().trim().email().max(150) });

/**
 * Starts an online payment for an existing order. The caller proves knowledge of the order (number + e-mail); the
 * amount is the order's outstanding balance from the database and no client amount is read. Returns only the iframe
 * URL - never merchant id, key, salt or the provider request. PAYTR_ENABLED off => 503 before any database work.
 */
async function start(request: Request) {
  const config = readPaytrConfig(process.env);
  if (config.state === "misconfigured") console.error("paytr_config_invalid", { missing: config.missing });
  if (config.state !== "enabled") return Response.json({ error: "Online ödeme şu anda kullanılamıyor.", code: config.state === "disabled" ? "PAYMENT_PROVIDER_DISABLED" : "PAYMENT_PROVIDER_UNAVAILABLE" }, { status: 503 });
  await rateLimit(request, "paytr-token", 10, 15 * 60_000);
  const parsed = startBody.safeParse(await readJson(request, 2_000));
  if (!parsed.success) return Response.json({ error: "Sipariş numarası ve e-posta adresini kontrol edin.", code: "INVALID_REQUEST" }, { status: 400 });
  const result = await startPaytrPayment(getDb(), { config, orderNumber: parsed.data.orderNumber, email: parsed.data.email, userIp: clientIp(request) });
  if (!result.ok) return Response.json({ error: result.error, code: result.code }, { status: result.status });
  return Response.json({ ok: true, iframeUrl: result.iframeUrl }, { headers: { "cache-control": "no-store" } });
}
export const POST = publicRoute(start);
