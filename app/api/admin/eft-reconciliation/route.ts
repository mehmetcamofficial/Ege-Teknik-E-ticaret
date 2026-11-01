import { getDb } from "@/db";
import { auditPermissionDenied, effectivePermissions, getAdminUser } from "@/lib/admin-auth";
import { loadEftReviewQueue } from "@/lib/eft-review-db";

/**
 * EFT-04C read-only review queue. Financial data requires explicit money
 * permission, not merely admin:read. No mutation endpoints are provided.
 */
export async function GET() {
  const admin = await getAdminUser("admin:read");
  if (!admin) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const permissions = await effectivePermissions(admin.userId, admin.role);
  if (!permissions.includes("payments:record") && !permissions.includes("payments:configure")) {
    await auditPermissionDenied(admin, "payments:record", "eft_reconciliation", "queue", { attempt: "read" });
    return Response.json({ error: "Finans inceleme yetkisi gerekli." }, { status: 403 });
  }
  const result = await loadEftReviewQueue(getDb());
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
