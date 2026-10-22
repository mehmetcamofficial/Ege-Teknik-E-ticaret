import { getAdminUser } from "@/lib/admin-auth";
import { listIntegrationStatus } from "@/lib/privileged-admin-db";

/**
 * integrations:read only. Returns metadata only (key, display name, configured flag,
 * short masked hint). PayTR is OUT OF SCOPE: no provider credential is stored, returned
 * or configurable here. The payments:configure boundary PayTR will later use already
 * exists server-side as requirePaymentsConfigure() in lib/admin-auth.ts; no route
 * calls it yet, and this module exports no write method at all.
 */
export async function GET() {
  const admin = await getAdminUser("integrations:read");
  if (!admin) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const integrations = await listIntegrationStatus();
  return Response.json({ integrations }, { headers: { "cache-control": "no-store" } });
}
