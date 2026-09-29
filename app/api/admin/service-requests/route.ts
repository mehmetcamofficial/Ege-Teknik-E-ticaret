import { getDb } from "@/db";
import { getAdminUser } from "@/lib/admin-auth";
import { loadServiceRequestsPage, serviceRequestsQuerySchema } from "@/lib/service-requests-db";

/**
 * Paginated service-request list (P0-A #3). Replaces the admin panel's dependence on GET
 * /api/admin/overview's requests array, which silently capped at 100 rows. Same page/pageSize/
 * pageCount shape as GET /api/admin/orders and GET /api/admin/finance - no new pagination scheme.
 */
export async function GET(request: Request) {
  const admin = await getAdminUser("admin:read");
  if (!admin) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const query = serviceRequestsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return Response.json({ error: "Geçersiz sorgu." }, { status: 400 });
  const result = await loadServiceRequestsPage(getDb(), query.data);
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
