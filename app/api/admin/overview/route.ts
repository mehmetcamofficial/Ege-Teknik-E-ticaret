import { getAdminUser } from "@/lib/admin-auth";
import { getDb } from "@/db";
import { blogPosts, orders, products, secondHandProducts, serviceRequests } from "@/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  if (!await getAdminUser()) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const db = getDb();
  const [productRows, requestRows, orderRows, secondHandRows, blogRows] = await Promise.all([
    db.select().from(products).orderBy(desc(products.updatedAt)),
    db.select().from(serviceRequests).orderBy(desc(serviceRequests.createdAt)).limit(100),
    db.select().from(orders).orderBy(desc(orders.createdAt)).limit(100),
    db.select().from(secondHandProducts).orderBy(desc(secondHandProducts.updatedAt)).limit(100),
    db.select().from(blogPosts).orderBy(desc(blogPosts.updatedAt)).limit(100),
  ]);
  return Response.json({ products: productRows, requests: requestRows, orders: orderRows, secondHand:secondHandRows, posts:blogRows });
}
