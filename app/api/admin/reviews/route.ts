import { getAdminUser } from "@/lib/admin-auth";
import { adminReviewListQuerySchema, decodeReviewCursor } from "@/lib/reviews";
import { listReviewsForAdmin } from "@/lib/reviews-db";
import { roleHasPermission } from "@/lib/security-policy";

/** Moderation queue. content:write only; the order number is shown only to roles that may also manage orders. */
export async function GET(request: Request) {
  const admin = await getAdminUser("content:write");
  if (!admin) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const query = adminReviewListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return Response.json({ error: "Geçersiz sorgu." }, { status: 400 });
  const cursor = decodeReviewCursor(query.data.cursor);
  if (query.data.cursor && !cursor) return Response.json({ error: "Geçersiz sayfa bağlantısı." }, { status: 400 });
  return Response.json(await listReviewsForAdmin(query.data.status, cursor, roleHasPermission(admin.role, "orders:write")), { headers: { "cache-control": "no-store" } });
}
