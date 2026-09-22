import { getDb } from "@/db";
import { auditLogs, installationJobs, orders, shipments } from "@/db/schema";
import { getAdminUser } from "@/lib/admin-auth";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { canTransitionOrder, orderStatuses, type OrderStatus } from "@/lib/order-domain";
import { readJson } from "@/lib/http-security";

const schema=z.object({status:z.enum(orderStatuses)});
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){
  const user=await getAdminUser("orders:write"); if(!user)return Response.json({error:"Yetkisiz erişim"},{status:403});
  const parsed=schema.safeParse(await readJson(request)); if(!parsed.success)return Response.json({error:"Geçersiz sipariş durumu"},{status:400});
  const {id}=await context.params; const db=getDb();
  const [current]=await db.select({status:orders.status}).from(orders).where(eq(orders.id,id)).limit(1);
  if(!current)return Response.json({error:"Sipariş bulunamadı"},{status:404});
  if(!canTransitionOrder(current.status as OrderStatus,parsed.data.status))return Response.json({error:`${current.status} durumundan ${parsed.data.status} durumuna geçilemez.`},{status:409});
  await db.transaction(async(tx)=>{await tx.update(orders).set({status:parsed.data.status,...(parsed.data.status==="paid"?{paymentStatus:"paid"}:{}),updatedAt:new Date()}).where(eq(orders.id,id));if(["shipped","delivery"].includes(parsed.data.status))await tx.insert(shipments).values({id:crypto.randomUUID(),orderId:id,status:parsed.data.status,shippedAt:parsed.data.status==="shipped"?new Date():null}).onConflictDoNothing();if(parsed.data.status==="installation")await tx.insert(installationJobs).values({id:crypto.randomUUID(),orderId:id,status:"pending"});});
  await db.insert(auditLogs).values({id:crypto.randomUUID(),actorUserId:user.userId,actorEmail:user.email,action:"status",entityType:"order",entityId:id,payload:{from:current.status,to:parsed.data.status}});
  return Response.json({ok:true});
}
