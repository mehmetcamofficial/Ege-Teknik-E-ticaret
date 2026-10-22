import { getDb } from "@/db";
import { clientIp } from "@/lib/admin-auth";
import { HttpError, assertSameOrigin, rateLimit } from "@/lib/http-security";
import { paymentHtmlHeaders, renderPaymentForm, renderPaymentFrame, renderPaymentUnavailable } from "@/lib/payment-pages";
import { readPaytrConfig } from "@/lib/paytr";
import { startPaytrPayment } from "@/lib/paytr-db";

const html = (body: string, status = 200) => new Response(body, { status, headers: paymentHtmlHeaders });
const ORDER_NUMBER = /^[A-Za-z0-9-]{4,40}$/;

/** Payment page. While PAYTR_ENABLED is off it only explains that online payment is unavailable - no form, no iframe. */
export async function GET(request: Request) {
  if (readPaytrConfig(process.env).state !== "enabled") return html(renderPaymentUnavailable());
  const order = new URL(request.url).searchParams.get("order") ?? "";
  return html(renderPaymentForm({ orderNumber: ORDER_NUMBER.test(order) ? order : "" }));
}

export async function POST(request: Request) {
  const config = readPaytrConfig(process.env);
  if (config.state !== "enabled") return html(renderPaymentUnavailable(), 503);
  try {
    assertSameOrigin(request);
    await rateLimit(request, "paytr-page", 10, 15 * 60_000);
    const raw = await request.text();
    if (raw.length > 2_000) return html(renderPaymentForm({ error: "İstek geçersiz." }), 413);
    const form = new URLSearchParams(raw);
    const orderNumber = (form.get("orderNumber") ?? "").trim(), email = (form.get("email") ?? "").trim();
    if (!ORDER_NUMBER.test(orderNumber) || !/^[^\s@]{1,64}@[^\s@]{1,100}$/.test(email)) return html(renderPaymentForm({ orderNumber: ORDER_NUMBER.test(orderNumber) ? orderNumber : "", error: "Sipariş numarası ve e-posta adresini kontrol edin." }), 400);
    const result = await startPaytrPayment(getDb(), { config, orderNumber, email, userIp: clientIp(request) });
    if (!result.ok) return html(renderPaymentForm({ orderNumber, error: result.error }), result.status);
    return html(renderPaymentFrame({ iframeUrl: result.iframeUrl, orderNumber }));
  } catch (error) {
    if (error instanceof HttpError) return html(renderPaymentForm({ error: error.message }), error.status);
    console.error("payment_page_error", { name: error instanceof Error ? error.name : "unknown" });
    return html(renderPaymentForm({ error: "İşlem tamamlanamadı. Lütfen tekrar deneyin." }), 500);
  }
}
