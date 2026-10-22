import { getAdminUser } from "@/lib/admin-auth";
import { analyticsQuerySchema, analyticsRangeErrorMessage, resolveDateRange } from "@/lib/analytics";
import { loadAnalyticsSummary } from "@/lib/analytics-db";

/**
 * First-party TRAFFIC analytics (Phase 6A) - unchanged by Phase 3.3B, which added the separate
 * sibling route `/api/admin/analytics/sales` rather than widening this one. Keeping traffic and sales
 * apart means neither payload can drift into the other's shape.
 *
 * Admin-only (admin:read - every authenticated admin role already has it, same as the rest of the
 * dashboard). Never reachable by a signed-out or public request.
 */
export async function GET(request: Request) {
  const admin = await getAdminUser("admin:read");
  if (!admin) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const query = analyticsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return Response.json({ error: "Geçersiz sorgu." }, { status: 400 });
  const now = new Date();
  const resolved = resolveDateRange(query.data.range, now, query.data.from, query.data.to);
  if (!resolved.ok) return Response.json({ error: analyticsRangeErrorMessage(resolved.error) }, { status: 400 });
  const summary = await loadAnalyticsSummary(resolved.range, now);
  return Response.json(summary, { headers: { "cache-control": "no-store" } });
}
