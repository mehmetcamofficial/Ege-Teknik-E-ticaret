import { getDb } from "@/db";
import { getAdminUser } from "@/lib/admin-auth";
import { operationsSummary } from "@/lib/notifications/outbox";

export const dynamic = "force-dynamic";

/** H5-A: new-order counters and notification health for the admin orders screen. Counts only; no customer data. */
export async function GET() {
  const admin = await getAdminUser("admin:read");
  if (!admin) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  return Response.json(await operationsSummary(getDb(), process.env), { headers: { "cache-control": "no-store" } });
}
