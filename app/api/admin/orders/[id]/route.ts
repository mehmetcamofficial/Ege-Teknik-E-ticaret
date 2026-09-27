import { getDb } from "@/db";
import { getAdminUser } from "@/lib/admin-auth";
import { z } from "zod";
import { orderStatuses } from "@/lib/order-domain";
import { HttpError, readJson, safeError } from "@/lib/http-security";
import { refusalResponse } from "@/lib/finance";
import { changeOrderStatus } from "@/lib/finance-db";

const statusBody=z.object({status:z.enum(orderStatuses)});

/**
 * Lifecycle status only. The state machine (canTransitionOrder) and the finance guards run inside one locked
 * transaction in lib/finance-db.ts changeOrderStatus: `paid` needs a recorded payment for the full total, `cancelled`
 * needs collected money refunded first and releases reserved stock; a refused change answers 404/409.
 * This route never writes payment_status by itself - it is derived from the payment ledger.
 */
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){
  const user=await getAdminUser("orders:write"); if(!user)return Response.json({error:"Yetkisiz erişim"},{status:403});
  try{
    const parsed=statusBody.safeParse(await readJson(request)); if(!parsed.success)return Response.json({error:"Geçersiz sipariş durumu"},{status:400});
    const {id}=await context.params;
    const result=await changeOrderStatus(getDb(),{orderId:id,to:parsed.data.status,actor:{userId:user.userId,email:user.email}});
    return result.ok?Response.json({ok:true,paymentStatus:result.paymentStatus}):refusalResponse(result.refusal);
  }catch(error){if(error instanceof HttpError)return safeError(error.status,error.message);throw error}
}
