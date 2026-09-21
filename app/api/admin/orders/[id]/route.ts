import { getDb } from "@/db";
import { auditLogs, orders } from "@/db/schema";
import { getAdminUser } from "@/lib/admin-auth";
import { eq } from "drizzle-orm";
import { z } from "zod";

const schema=z.object({status:z.enum(["pending_payment","confirmed","preparing","scheduled","completed","cancelled"])});
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){
  const user=await getAdminUser(); if(!user)return Response.json({error:"Yetkisiz erişim"},{status:403});
  const parsed=schema.safeParse(await request.json().catch(()=>null)); if(!parsed.success)return Response.json({error:"Geçersiz sipariş durumu"},{status:400});
  const {id}=await context.params; const db=getDb();
  await db.update(orders).set({status:parsed.data.status,updatedAt:new Date().toISOString()}).where(eq(orders.id,id));
  await db.insert(auditLogs).values({id:crypto.randomUUID(),actorUserId:user.userId,actorEmail:user.email,action:"status",entityType:"order",entityId:id,payload:JSON.stringify(parsed.data)});
  return Response.json({ok:true});
}
