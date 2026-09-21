import { getAdminUser } from "@/lib/admin-auth";
import { getDb } from "@/db";
import { orders, products, serviceRequests } from "@/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  if (!await getAdminUser()) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const db = getDb();
  const [productRows, requestRows, orderRows] = await Promise.all([
    db.select().from(products).orderBy(desc(products.updatedAt)),
    db.select().from(serviceRequests).orderBy(desc(serviceRequests.createdAt)).limit(100),
    db.select().from(orders).orderBy(desc(orders.createdAt)).limit(100),
  ]);
  return Response.json({ products: productRows, requests: requestRows, orders: orderRows });
}
