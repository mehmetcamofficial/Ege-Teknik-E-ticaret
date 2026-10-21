import { getDb } from "@/db";
import { getAdminUser } from "@/lib/admin-auth";
import { analyticsRangeErrorMessage, resolveDateRange } from "@/lib/analytics";
import { financeQuerySchema, loadFinanceReport } from "@/lib/finance-db";

/**
 * Finance dashboard + sales report (Phase 3.3A). admin:read - the same audience that already sees every order and
 * the sales analytics. Every amount is computed in SQL from orders/payments/refunds; nothing is taken from the
 * client except the filters. "collected" exists only where a payment row with status 'paid' exists.
 */
export async function GET(request: Request) {
  const admin = await getAdminUser("admin:read");
  if (!admin) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const query = financeQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return Response.json({ error: "Geçersiz sorgu." }, { status: 400 });
  const resolved = resolveDateRange(query.data.range, new Date(), query.data.from, query.data.to);
  if (!resolved.ok) return Response.json({ error: analyticsRangeErrorMessage(resolved.error) }, { status: 400 });
  const { paymentStatus, orderStatus, method, page } = query.data;
  const report = await loadFinanceReport(getDb(), { range: resolved.range, filters: { paymentStatus, orderStatus, method }, page });
  return Response.json(report, { headers: { "cache-control": "no-store" } });
}
