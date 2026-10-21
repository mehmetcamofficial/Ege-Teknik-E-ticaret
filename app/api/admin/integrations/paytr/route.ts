import { getDb } from "@/db";
import { getAdminUser } from "@/lib/admin-auth";
import { loadPaytrAdminMetrics } from "@/lib/paytr-db";
import { buildPaytrAdminStatus } from "@/lib/paytr-status";

/**
 * Read-only PayTR status for the admin (integrations:read, the same boundary as GET /api/admin/integrations).
 * Configuration is reported as booleans, a masked merchant id and variable NAMES only - the merchant key and salt
 * are never read into this response. There is deliberately no write method: configuration lives in the host env.
 */
export async function GET() {
  const admin = await getAdminUser("integrations:read");
  if (!admin) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const status = buildPaytrAdminStatus(process.env);
  const metrics = await loadPaytrAdminMetrics(getDb());
  return Response.json({ status, metrics }, { headers: { "cache-control": "no-store" } });
}
