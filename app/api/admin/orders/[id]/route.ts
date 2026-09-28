import { getDb } from "@/db";
import { getAdminUser } from "@/lib/admin-auth";
import { z } from "zod";
import { orderStatuses } from "@/lib/order-domain";
import { transitionOrder } from "@/lib/order-transition";
import { orderTransitionDeps } from "@/lib/order-transition-db";
import { readJson } from "@/lib/http-security";

const schema=z.object({status:z.enum(orderStatuses),expectedStatus:z.enum(orderStatuses)});
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){
  const user=await getAdminUser("orders:write"); if(!user)return Response.json({error:"Yetkisiz erişim"},{status:403});
  const parsed=schema.safeParse(await readJson(request)); if(!parsed.success)return Response.json({error:"Geçersiz sipariş durumu"},{status:400});
  const {id}=await context.params; const db=getDb();
  const result=await transitionOrder({orderId:id,expectedStatus:parsed.data.expectedStatus,nextStatus:parsed.data.status,actor:user},orderTransitionDeps(db));
  if(result.ok)return Response.json({ok:true});
  if(result.code==="NOT_FOUND")return Response.json({error:"Sipariş bulunamadı"},{status:404});
  if(result.code==="INVENTORY_INVARIANT")return Response.json({error:"Sipariş stoğu güvenli biçimde iade edilemedi; durum değiştirilmedi."},{status:409});
  if(result.code==="STALE")return Response.json({error:"Sipariş durumu başka bir işlem tarafından değiştirildi; sayfayı yenileyin."},{status:409});
  return Response.json({error:`${result.actual} durumundan ${parsed.data.status} durumuna geçilemez.`},{status:409});
}
