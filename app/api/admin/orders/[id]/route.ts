import { getDb } from "@/db";
import { auditLogs, installationJobs, inventory, orderItems, orders, shipments } from "@/db/schema";
import { getAdminUser } from "@/lib/admin-auth";
import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { orderStatuses, type OrderStatus } from "@/lib/order-domain";
import { transitionOrder } from "@/lib/order-transition";
import { readJson } from "@/lib/http-security";

const schema=z.object({status:z.enum(orderStatuses),expectedStatus:z.enum(orderStatuses)});
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){
  const user=await getAdminUser("orders:write"); if(!user)return Response.json({error:"Yetkisiz erişim"},{status:403});
  const parsed=schema.safeParse(await readJson(request)); if(!parsed.success)return Response.json({error:"Geçersiz sipariş durumu"},{status:400});
  const {id}=await context.params; const db=getDb();
  const result=await transitionOrder({orderId:id,expectedStatus:parsed.data.expectedStatus,nextStatus:parsed.data.status,actor:user},{
    transaction:(work)=>db.transaction(async(tx)=>work({
      lockOrder:async(orderId)=>{const [row]=await tx.select({status:orders.status}).from(orders).where(eq(orders.id,orderId)).for("update").limit(1);return row?{status:row.status as OrderStatus}:null},
      listItems:(orderId)=>tx.select({productId:orderItems.productId,quantity:orderItems.quantity}).from(orderItems).where(eq(orderItems.orderId,orderId)),
      compareAndSetStatus:async(orderId,expected,next)=>{const changed=await tx.update(orders).set({status:next,...(next==="paid"?{paymentStatus:"paid"}:{}),updatedAt:new Date()}).where(and(eq(orders.id,orderId),eq(orders.status,expected))).returning({id:orders.id});return changed.length===1},
      releaseInventory:async(productId,quantity)=>{const changed=await tx.update(inventory).set({onHand:sql`${inventory.onHand}+${quantity}`,reserved:sql`${inventory.reserved}-${quantity}`,version:sql`${inventory.version}+1`,updatedAt:new Date()}).where(and(eq(inventory.productId,productId),gte(inventory.reserved,quantity))).returning({id:inventory.id});return changed.length===1},
      createShipment:async(orderId,status)=>{await tx.insert(shipments).values({id:crypto.randomUUID(),orderId,status,shippedAt:status==="shipped"?new Date():null}).onConflictDoNothing()},
      createInstallationJob:async(orderId)=>{await tx.insert(installationJobs).values({id:crypto.randomUUID(),orderId,status:"pending"})},
      insertAudit:async({actor,orderId,from,to})=>{await tx.insert(auditLogs).values({id:crypto.randomUUID(),actorUserId:actor.userId,actorEmail:actor.email,action:"status",entityType:"order",entityId:orderId,payload:{from,to}})},
    })),
  });
  if(result.ok)return Response.json({ok:true});
  if(result.code==="NOT_FOUND")return Response.json({error:"Sipariş bulunamadı"},{status:404});
  if(result.code==="INVENTORY_INVARIANT")return Response.json({error:"Sipariş stoğu güvenli biçimde iade edilemedi; durum değiştirilmedi."},{status:409});
  if(result.code==="STALE")return Response.json({error:"Sipariş durumu başka bir işlem tarafından değiştirildi; sayfayı yenileyin."},{status:409});
  return Response.json({error:`${result.actual} durumundan ${parsed.data.status} durumuna geçilemez.`},{status:409});
}
