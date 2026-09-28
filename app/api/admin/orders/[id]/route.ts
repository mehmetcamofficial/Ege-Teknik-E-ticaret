import { getDb } from "@/db";
import { orderItems, orders, products } from "@/db/schema";
import { getAdminUser } from "@/lib/admin-auth";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { orderStatuses } from "@/lib/order-domain";
import { HttpError, readJson, safeError } from "@/lib/http-security";
import { refusalResponse } from "@/lib/finance";
import { changeOrderStatus } from "@/lib/finance-db";

const statusBody=z.object({status:z.enum(orderStatuses)});
const safeImage=(url:string|null|undefined)=>url&&(url.startsWith("https://")||(url.startsWith("/")&&!url.startsWith("//")))?url:null;

/**
 * The order's lines exactly as sold: name, SKU, quantity, unit price, VAT and line total come from the order_items
 * snapshot, never from the live product. Only the thumbnail is read from the product (display only, no money).
 */
export async function GET(_request:Request,context:{params:Promise<{id:string}>}){
  const user=await getAdminUser("admin:read"); if(!user)return Response.json({error:"Yetkisiz erişim"},{status:403});
  const {id}=await context.params; const db=getDb();
  const [order]=await db.select({id:orders.id}).from(orders).where(eq(orders.id,id)).limit(1);
  if(!order)return Response.json({error:"Sipariş bulunamadı."},{status:404});
  const rows=await db.select({id:orderItems.id,productName:orderItems.productName,productSku:orderItems.productSku,productSnapshot:orderItems.productSnapshot,quantity:orderItems.quantity,unitPrice:orderItems.unitPrice,vatRateBps:orderItems.vatRateBps,vatAmount:orderItems.vatAmount,lineTotal:orderItems.lineTotal,imageUrl:products.imageUrl})
    .from(orderItems).leftJoin(products,eq(products.id,orderItems.productId)).where(eq(orderItems.orderId,id)).orderBy(asc(orderItems.createdAt),asc(orderItems.id));
  const items=rows.map(({productSnapshot,imageUrl,...r})=>{const snap=(productSnapshot&&typeof productSnapshot==="object"?productSnapshot:{}) as {capacity?:unknown};return{...r,capacity:typeof snap.capacity==="string"?snap.capacity:"",imageUrl:safeImage(imageUrl)}});
  return Response.json({items},{headers:{"cache-control":"no-store"}});
}

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
