import { getAdminUser } from "@/lib/admin-auth";
import { getDb } from "@/db";
import { auditLogs, secondHandProducts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { secondHandSchema } from "../route";

export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){
  const user=await getAdminUser(); if(!user)return Response.json({error:"Yetkisiz erişim"},{status:403});
  const parsed=secondHandSchema.partial().safeParse(await request.json().catch(()=>null)); if(!parsed.success||!Object.keys(parsed.data).length)return Response.json({error:"Alanları kontrol edin."},{status:400});
  const {id}=await context.params,db=getDb(); await db.update(secondHandProducts).set({...parsed.data,updatedAt:new Date().toISOString()}).where(eq(secondHandProducts.id,id));
  await db.insert(auditLogs).values({id:crypto.randomUUID(),actorUserId:user.userId,actorEmail:user.email,action:"update",entityType:"second_hand_product",entityId:id,payload:JSON.stringify(parsed.data)});
  return Response.json({ok:true});
}
export async function DELETE(_request:Request,context:{params:Promise<{id:string}>}){const user=await getAdminUser();if(!user)return Response.json({error:"Yetkisiz erişim"},{status:403});const {id}=await context.params,db=getDb();await db.update(secondHandProducts).set({status:"sold",stock:0,updatedAt:new Date().toISOString()}).where(eq(secondHandProducts.id,id));await db.insert(auditLogs).values({id:crypto.randomUUID(),actorUserId:user.userId,actorEmail:user.email,action:"archive",entityType:"second_hand_product",entityId:id,payload:"{}"});return Response.json({ok:true})}
