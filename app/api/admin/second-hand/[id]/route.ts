import { getAdminUser } from "@/lib/admin-auth";
import { secondHandProducts, secondHandReservations } from "@/db/schema";
import { auditedMutation } from "@/lib/admin-audited";
import { eq } from "drizzle-orm";
import { secondHandPatchSchema } from "../schema";
import { readJson } from "@/lib/http-security";
import { secondHandPublishBlockers } from "@/lib/second-hand-policy";

class HasReservations extends Error {}
class PublishRefused extends Error {
  constructor(readonly status: number, readonly blockers: string[]) { super("Second-hand publication refused"); }
}

export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){
  const user=await getAdminUser("catalog:write"); if(!user)return Response.json({error:"Yetkisiz erişim"},{status:403});
  const parsed=secondHandPatchSchema.safeParse(await readJson(request)); if(!parsed.success||!Object.keys(parsed.data).length)return Response.json({error:"Alanları kontrol edin."},{status:400});
  const {id}=await context.params;
  try {
    await auditedMutation(user,{action:"update",entityType:"second_hand_product",entityId:id,payload:parsed.data},async(tx)=>{
      // Lock, validate the merged state, update and audit in the same transaction.
      const [current]=await tx.select().from(secondHandProducts).where(eq(secondHandProducts.id,id)).limit(1).for("update");
      if(!current)throw new PublishRefused(404,["İlan bulunamadı."]);
      const blockers=secondHandPublishBlockers({...current,...parsed.data});
      if(blockers.length)throw new PublishRefused(422,blockers);
      await tx.update(secondHandProducts).set({...parsed.data,updatedAt:new Date()}).where(eq(secondHandProducts.id,id));
    });
  } catch(error) {
    if(error instanceof PublishRefused)return Response.json({error:error.blockers[0],blockers:error.blockers},{status:error.status});
    throw error;
  }
  return Response.json({ok:true});
}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getAdminUser("catalog:write");
  if (!user) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const { id } = await context.params;

  const url = new URL(request.url);
  const hard = url.searchParams.get("hard") === "1";

  if (hard) {
    try {
      // The reservation check, the delete and the audit row are one transaction: a refusal writes nothing.
      await auditedMutation(user, { action: "delete", entityType: "second_hand_product", entityId: id, payload: {} }, async (tx) => {
        const [res] = await tx.select({ id: secondHandReservations.id }).from(secondHandReservations).where(eq(secondHandReservations.productId, id)).limit(1);
        if (res) throw new HasReservations();
        await tx.delete(secondHandProducts).where(eq(secondHandProducts.id, id));
      });
    } catch (error) {
      if (error instanceof HasReservations) return Response.json({ error: "Bu ilana ait rezervasyon kaydı bulunduğu için kalıcı olarak silinemez. İlanı 'Satıldı' veya 'Taslak' durumuna alabilirsiniz." }, { status: 409 });
      throw error;
    }
    return Response.json({ ok: true, hard: true });
  }

  await auditedMutation(user, { action: "archive", entityType: "second_hand_product", entityId: id, payload: {} }, async (tx) => { await tx.update(secondHandProducts).set({ status: "sold", stock: 0, updatedAt: new Date() }).where(eq(secondHandProducts.id, id)); });
  return Response.json({ ok: true, archived: true });
}
