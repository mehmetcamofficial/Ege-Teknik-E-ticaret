import { getDb } from "@/db";
import { orderItems, orders, products } from "@/db/schema";
import { loadOrderAcceptedLegalDocuments } from "@/lib/legal-db";
import { getAdminUser } from "@/lib/admin-auth";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { orderStatuses } from "@/lib/order-domain";
import { transitionOrder } from "@/lib/order-transition";
import { orderTransitionDeps } from "@/lib/order-transition-db";
import { readJson } from "@/lib/http-security";

const safeImage=(url:string|null|undefined)=>url&&(url.startsWith("https://")||(url.startsWith("/")&&!url.startsWith("//")))?url:null;

/**
 * The order summary (P0-A #3: lets the admin panel open any order by id instead of only the 100
 * most recent from GET /api/admin/overview) plus its lines exactly as sold: name, SKU, quantity,
 * unit price, VAT and line total come from the order_items snapshot, never from the live product.
 * Only the thumbnail is read from the product (display only, no money).
 */
export async function GET(_request:Request,context:{params:Promise<{id:string}>}){
  const user=await getAdminUser("admin:read"); if(!user)return Response.json({error:"Yetkisiz erişim"},{status:403});
  const {id}=await context.params; const db=getDb();
  const [order]=await db.select({
    id:orders.id,orderNumber:orders.orderNumber,customerName:orders.customerName,phone:orders.phone,email:orders.email,city:orders.city,address:orders.address,
    subtotal:orders.subtotal,vatTotal:orders.vatTotal,shippingTotal:orders.shippingTotal,installationTotal:orders.installationTotal,total:orders.total,
    paymentStatus:orders.paymentStatus,status:orders.status,notes:orders.notes,installationPreference:orders.installationPreference,
    shippingAddressSnapshot:orders.shippingAddressSnapshot,createdAt:orders.createdAt,
  }).from(orders).where(eq(orders.id,id)).limit(1);
  if(!order)return Response.json({error:"Sipariş bulunamadı."},{status:404});
  const rows=await db.select({id:orderItems.id,productName:orderItems.productName,productSku:orderItems.productSku,productSnapshot:orderItems.productSnapshot,quantity:orderItems.quantity,unitPrice:orderItems.unitPrice,vatRateBps:orderItems.vatRateBps,vatAmount:orderItems.vatAmount,lineTotal:orderItems.lineTotal,imageUrl:products.imageUrl})
    .from(orderItems).leftJoin(products,eq(products.id,orderItems.productId)).where(eq(orderItems.orderId,id)).orderBy(asc(orderItems.createdAt),asc(orderItems.id));
  const items=rows.map(({productSnapshot,imageUrl,...r})=>{const snap=(productSnapshot&&typeof productSnapshot==="object"?productSnapshot:{}) as {capacity?:unknown};return{...r,capacity:typeof snap.capacity==="string"?snap.capacity:"",imageUrl:safeImage(imageUrl)}});
  // Legal acceptance evidence (P3-LEGAL-3B): joined order_legal_acceptances -> versions -> documents so an
  // operator can see WHICH exact version was accepted and open that historical text. The body is never
  // returned here; the immutable version is reachable at /legal/{slug}?version={id}. Empty array = a
  // pre-feature order, which is real history rather than an error.
  const legalAcceptances=await loadOrderAcceptedLegalDocuments(id);
  return Response.json({order:{...order,createdAt:order.createdAt.toISOString()},items,legalAcceptances},{headers:{"cache-control":"no-store"}});
}

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
