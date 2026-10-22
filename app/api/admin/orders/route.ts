import { getDb } from "@/db";
import { getAdminUser } from "@/lib/admin-auth";
import { loadOrdersPage, ordersQuerySchema } from "@/lib/orders-db";

/**
 * Paginated order list (P0-A #3). Replaces the admin panel's dependence on GET /api/admin/overview's
 * orders array, which silently capped at 100 rows with no way to reach anything older. Same
 * page/pageSize/pageCount shape as GET /api/admin/finance (lib/finance-db.ts) - no new pagination scheme.
 */
export async function GET(request: Request) {
  const admin = await getAdminUser("admin:read");
  if (!admin) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const query = ordersQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return Response.json({ error: "Geçersiz sorgu." }, { status: 400 });
  const result = await loadOrdersPage(getDb(), query.data);
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
