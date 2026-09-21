import { getDb } from "@/db";
import { auditLogs, products } from "@/db/schema";
import { catalogDefaults } from "@/lib/catalog-defaults";
import { getAdminUser } from "@/lib/admin-auth";

export async function POST() {
  const user = await getAdminUser();
  if (!user) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const db = getDb();
  await db.insert(products).values(catalogDefaults).onConflictDoNothing();
  await db.insert(auditLogs).values({
    id:crypto.randomUUID(), actorUserId:user.userId, actorEmail:user.email,
    action:"import", entityType:"catalog", entityId:"gree-defaults",
    payload:JSON.stringify({ count:catalogDefaults.length }),
  });
  return Response.json({ ok:true, count:catalogDefaults.length });
}
