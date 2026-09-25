import { getAdminUser } from "@/lib/admin-auth";
import { getDb } from "@/db";
import { auditLogs, secondHandProducts, secondHandReservations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { secondHandSchema } from "../schema";
import { readJson } from "@/lib/http-security";

export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){
  const user=await getAdminUser("catalog:write"); if(!user)return Response.json({error:"Yetkisiz erişim"},{status:403});
  const parsed=secondHandSchema.partial().safeParse(await readJson(request)); if(!parsed.success||!Object.keys(parsed.data).length)return Response.json({error:"Alanları kontrol edin."},{status:400});
  const {id}=await context.params,db=getDb(); await db.update(secondHandProducts).set({...parsed.data,updatedAt:new Date()}).where(eq(secondHandProducts.id,id));
  await db.insert(auditLogs).values({id:crypto.randomUUID(),actorUserId:user.userId,actorEmail:user.email,action:"update",entityType:"second_hand_product",entityId:id,payload:parsed.data});
  return Response.json({ok:true});
}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getAdminUser("catalog:write");
  if (!user) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const { id } = await context.params;
  const db = getDb();

  const url = new URL(request.url);
  const hard = url.searchParams.get("hard") === "1";

  if (hard) {
    const [res] = await db.select({ id: secondHandReservations.id }).from(secondHandReservations).where(eq(secondHandReservations.productId, id)).limit(1);
    if (res) return Response.json({ error: "Bu ilana ait rezervasyon kaydı bulunduğu için kalıcı olarak silinemez. İlanı 'Satıldı' veya 'Taslak' durumuna alabilirsiniz." }, { status: 409 });
    await db.delete(secondHandProducts).where(eq(secondHandProducts.id, id));
    await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: user.userId, actorEmail: user.email, action: "delete", entityType: "second_hand_product", entityId: id, payload: {} });
    return Response.json({ ok: true, hard: true });
  }

  await db.update(secondHandProducts).set({ status: "sold", stock: 0, updatedAt: new Date() }).where(eq(secondHandProducts.id, id));
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: user.userId, actorEmail: user.email, action: "archive", entityType: "second_hand_product", entityId: id, payload: {} });
  return Response.json({ ok: true, archived: true });
}
