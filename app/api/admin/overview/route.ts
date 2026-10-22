import { getAdminUser } from "@/lib/admin-auth";
import { getDb } from "@/db";
import { blogPosts, brands, categories, inventory, orders, products, secondHandProducts, serviceRequests } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export async function GET() {
  if (!await getAdminUser()) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const db = getDb();
  const [productRows, requestRows, orderRows, secondHandRows, blogRows, brandRows, categoryRows] = await Promise.all([
    db.select({ product: products, stock: inventory.onHand }).from(products).leftJoin(inventory, eq(inventory.productId, products.id)).orderBy(desc(products.updatedAt)),
    db.select().from(serviceRequests).orderBy(desc(serviceRequests.createdAt)).limit(100),
    db.select().from(orders).orderBy(desc(orders.createdAt)).limit(100),
    db.select().from(secondHandProducts).orderBy(desc(secondHandProducts.updatedAt)).limit(100),
    db.select().from(blogPosts).orderBy(desc(blogPosts.updatedAt)).limit(100),
    db.select().from(brands).orderBy(brands.name),
    db.select().from(categories).orderBy(categories.sortOrder, categories.name),
  ]);
  return Response.json({ products: productRows.map(({ product, stock }) => ({ ...product, stock: stock ?? 0 })), requests: requestRows, orders: orderRows, secondHand:secondHandRows, posts:blogRows, brands:brandRows, categories:categoryRows });
}
