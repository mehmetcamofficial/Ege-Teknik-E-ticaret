import { getAdminUser } from "@/lib/admin-auth";
import { analyticsQuerySchema, resolveDateRange, resolvePreviousRange, trendGranularityFor } from "@/lib/analytics";
import { loadSalesSummary } from "@/lib/analytics-db";

/**
 * Sales overview aggregates (Phase 3.3B). Deliberately a SEPARATE route from the sibling
 * `/api/admin/analytics` traffic endpoint, not a widened version of it: traffic payloads and sales
 * payloads have different shapes, different privacy profiles and different refresh cadences, and
 * keeping them apart means neither can quietly grow the other's fields.
 *
 * Admin-only: `admin:read`, the permission every authenticated admin role already holds for the rest
 * of the dashboard. The check happens before any database work. `no-store`, because the response is
 * commercially sensitive and must never be cached by a proxy or the browser.
 *
 * AGGREGATE-ONLY BY CONSTRUCTION: no query here selects an order row or a customer column, so the
 * response is sums, counts and bucketed totals only. Rendering the sales dashboard cannot put a
 * customer name, phone, email or address into the browser - that is the point of this endpoint.
 *
 * TERMINOLOGY: `orderValue` is SUM(orders.total), the amount customers were ASKED to pay, shown as
 * "Sipariş Tutarı". It is never called ciro, and never tahsilat: no payment provider is integrated,
 * `payments`/`refunds` are never written, and `orders.payment_status` is an operator's manual field
 * rather than a gateway confirmation. Nothing here is derived from it.
 */
export async function GET(request: Request) {
  const admin = await getAdminUser("admin:read");
  if (!admin) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const query = analyticsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return Response.json({ error: "Geçersiz sorgu." }, { status: 400 });

  const now = new Date();
  const resolved = resolveDateRange(query.data.range, now, query.data.from, query.data.to);
  if (!resolved.ok) return Response.json({ error: resolved.error }, { status: 400 });
  // Both windows come from the same preset and the same inputs under the same 400-day cap, so the
  // comparison period is always exactly the window immediately before the current one.
  const previous = resolvePreviousRange(query.data.range, now, query.data.from, query.data.to);
  if (!previous.ok) return Response.json({ error: previous.error }, { status: 400 });

  const summary = await loadSalesSummary(resolved.range, previous.range, trendGranularityFor(resolved.range));
  return Response.json(summary, { headers: { "cache-control": "no-store" } });
}