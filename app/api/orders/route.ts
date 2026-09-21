import { getDb } from "@/db";
import { orderItems, orders, products } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

const schema = z.object({
  customerName:z.string().min(2).max(100), phone:z.string().min(7).max(30), email:z.string().email().max(150),
  city:z.string().min(2).max(100), address:z.string().min(8).max(500), paymentProvider:z.enum(["PayTR","iyzico","discovery"]),
  items:z.array(z.object({ productId:z.string().min(1).max(100), quantity:z.number().int().min(1).max(10) })).min(1).max(20),
});

export async function POST(request:Request) {
  const parsed=schema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success) return Response.json({error:"Sipariş bilgilerini kontrol edin."},{status:400});
  const requested=new Map(parsed.data.items.map(item=>[item.productId,item.quantity]));
  const rows=await getDb().select().from(products).where(and(inArray(products.id,[...requested.keys()]),eq(products.status,"published"),eq(products.saleMode,"online")));
  if(rows.length!==requested.size) return Response.json({error:"Sepette satışa açık olmayan bir ürün var."},{status:409});
  for(const row of rows) if(row.stock < (requested.get(row.id) ?? 0)) return Response.json({error:`${row.name} için yeterli stok yok.`},{status:409});
  const id=crypto.randomUUID(); const orderNumber=`ETS-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${id.slice(0,6).toUpperCase()}`;
  const total=rows.reduce((sum,row)=>sum+row.price*(requested.get(row.id)??0),0); const db=getDb();
  await db.insert(orders).values({id,orderNumber,customerName:parsed.data.customerName,phone:parsed.data.phone,email:parsed.data.email,city:parsed.data.city,address:parsed.data.address,total,status:"pending_payment",paymentProvider:parsed.data.paymentProvider});
  await db.insert(orderItems).values(rows.map(row=>({id:crypto.randomUUID(),orderId:id,productId:row.id,productName:row.name,unitPrice:row.price,quantity:requested.get(row.id)??1})));
  return Response.json({ok:true,orderNumber,total,status:"pending_payment"},{status:201});
}
