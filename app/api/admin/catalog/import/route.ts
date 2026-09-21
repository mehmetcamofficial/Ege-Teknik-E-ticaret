import { getDb } from "@/db";
import { auditLogs } from "@/db/schema";
import { getAdminUser } from "@/lib/admin-auth";
import { ensureCatalogInitialized } from "@/lib/catalog-service";

export async function POST() {
  const user = await getAdminUser();
  if (!user) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const db = getDb();
  const result = await ensureCatalogInitialized();
  await db.insert(auditLogs).values({
    id:crypto.randomUUID(), actorUserId:user.userId, actorEmail:user.email,
    action:"import", entityType:"catalog", entityId:"gree-defaults",
    payload:JSON.stringify(result),
  });
  return Response.json({ ok:true, ...result });
}
