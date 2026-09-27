import { getDb } from "@/db";
import { getAdminUser } from "@/lib/admin-auth";
import { z } from "zod";
import { orderStatuses } from "@/lib/order-domain";
import { transitionOrder } from "@/lib/order-transition";
import { orderTransitionDeps } from "@/lib/order-transition-db";
import { readJson } from "@/lib/http-security";

const schema=z.object({status:z.enum(orderStatuses),expectedStatus:z.enum(orderStatuses)});
/**
 * Lifecycle status only. The request must carry `expectedStatus` (compare-and-set: a stale view is refused, never applied).
 * The state machine, the finance guards (`paid` needs a recorded payment for the full total; `cancelled` needs collected
 * money refunded first), stock release, side records and the audit all run in one locked transaction (lib/order-transition*.ts).
 * This route never writes payment_status by itself - it is derived from the payment ledger.
 */
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){
  const user=await getAdminUser("orders:write"); if(!user)return Response.json({error:"Yetkisiz erişim"},{status:403});
  const parsed=schema.safeParse(await readJson(request)); if(!parsed.success)return Response.json({error:"Geçersiz sipariş durumu"},{status:400});
  const {id}=await context.params; const db=getDb();
  const result=await transitionOrder({orderId:id,expectedStatus:parsed.data.expectedStatus,nextStatus:parsed.data.status,actor:user},orderTransitionDeps(db));
  if(result.ok)return Response.json({ok:true,paymentStatus:result.paymentStatus});
  if(result.code==="NOT_FOUND")return Response.json({error:"Sipariş bulunamadı"},{status:404});
  // Finance guards (Phase 3.3A), evaluated on the locked row inside the same transaction as the compare-and-set.
  if(result.code==="PAYMENT_NOT_RECORDED")return Response.json({error:"Sipariş tutarının tamamı için ödeme kaydı yok. Önce tahsilatı kaydedin.",code:result.code},{status:409});
  if(result.code==="REFUND_REQUIRED")return Response.json({error:"Bu siparişte tahsil edilmiş tutar var. İptal etmeden önce iadeyi kaydedin.",code:result.code},{status:409});
  if(result.code==="INVENTORY_INVARIANT")return Response.json({error:"Sipariş stoğu güvenli biçimde iade edilemedi; durum değiştirilmedi."},{status:409});
  if(result.code==="STALE")return Response.json({error:"Sipariş durumu başka bir işlem tarafından değiştirildi; sayfayı yenileyin."},{status:409});
  return Response.json({error:`${result.actual} durumundan ${parsed.data.status} durumuna geçilemez.`},{status:409});
}
