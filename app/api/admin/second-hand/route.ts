import { getAdminUser } from "@/lib/admin-auth";
import { getDb } from "@/db";
import { auditLogs, secondHandProducts } from "@/db/schema";
import { readJson } from "@/lib/http-security";
import { secondHandSchema } from "./schema";

export async function POST(request:Request){
  const user=await getAdminUser("catalog:write"); if(!user)return Response.json({error:"Yetkisiz erişim"},{status:403});
  const parsed=secondHandSchema.safeParse(await readJson(request)); if(!parsed.success)return Response.json({error:"İkinci el ürün alanlarını kontrol edin."},{status:400});
  const id=crypto.randomUUID(), db=getDb(); await db.insert(secondHandProducts).values({id,...parsed.data});
  await db.insert(auditLogs).values({id:crypto.randomUUID(),actorUserId:user.userId,actorEmail:user.email,action:"create",entityType:"second_hand_product",entityId:id,payload:parsed.data});
  return Response.json({ok:true,id},{status:201});
}
