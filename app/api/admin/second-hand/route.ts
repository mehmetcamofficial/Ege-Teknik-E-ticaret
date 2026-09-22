import { getAdminUser } from "@/lib/admin-auth";
import { getDb } from "@/db";
import { auditLogs, secondHandProducts } from "@/db/schema";
import { z } from "zod";
import { readJson } from "@/lib/http-security";

export const secondHandSchema = z.object({
  name:z.string().min(2).max(160), slug:z.string().min(2).max(160).regex(/^[a-z0-9-]+$/), category:z.string().min(2).max(80),
  condition:z.string().max(80).default("İyi"), testNotes:z.string().max(3000).default(""), warranty:z.string().max(160).default(""),
  price:z.coerce.number().int().min(0), stock:z.coerce.number().int().min(0).max(99), imageUrl:z.string().max(1000).default(""),
  status:z.enum(["draft","published","sold"]), description:z.string().max(4000).default(""),
});

export async function POST(request:Request){
  const user=await getAdminUser("catalog:write"); if(!user)return Response.json({error:"Yetkisiz erişim"},{status:403});
  const parsed=secondHandSchema.safeParse(await readJson(request)); if(!parsed.success)return Response.json({error:"İkinci el ürün alanlarını kontrol edin."},{status:400});
  const id=crypto.randomUUID(), db=getDb(); await db.insert(secondHandProducts).values({id,...parsed.data});
  await db.insert(auditLogs).values({id:crypto.randomUUID(),actorUserId:user.userId,actorEmail:user.email,action:"create",entityType:"second_hand_product",entityId:id,payload:parsed.data});
  return Response.json({ok:true,id},{status:201});
}
