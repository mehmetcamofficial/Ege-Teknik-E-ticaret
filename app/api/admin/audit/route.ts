import { getAdminUser } from "@/lib/admin-auth";
import { listAuditHistory } from "@/lib/privileged-admin-db";

/**
 * audit:read only, read-only by design: this module exports no mutating method, and
 * audit_logs has no DELETE anywhere in the codebase. Raw payloads are not returned -
 * only actor/action/entity/time, so a future secret-bearing payload cannot leak here.
 */
export async function GET(request: Request) {
  const admin = await getAdminUser("audit:read");
  if (!admin) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const actor = new URL(request.url).searchParams.get("actor")?.trim();
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? "50");
  const entries = await listAuditHistory({
    actorUserId: actor && /^[0-9a-f-]{36}$/i.test(actor) ? actor : undefined,
    limit: Number.isFinite(limit) ? limit : 50,
  });
  return Response.json({ entries }, { headers: { "cache-control": "no-store" } });
}
