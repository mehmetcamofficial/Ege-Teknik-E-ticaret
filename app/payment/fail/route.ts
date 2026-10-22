import { getDb } from "@/db";
import { paymentHtmlHeaders, renderPaymentResult } from "@/lib/payment-pages";
import { loadPaytrAttempt } from "@/lib/paytr-db";

/** Shows the attempt's real state (set only by the verified PayTR callback). Landing here never marks anything paid. */
export async function GET(request: Request) {
  const ref = new URL(request.url).searchParams.get("ref") ?? "";
  let attempt: { orderNumber: string; status: string } | null = null;
  try { attempt = await loadPaytrAttempt(getDb(), ref); } catch (error) { console.error("payment_result_error", { name: error instanceof Error ? error.name : "unknown" }); }
  return new Response(renderPaymentResult({ page: "fail", attempt }), { headers: paymentHtmlHeaders });
}
