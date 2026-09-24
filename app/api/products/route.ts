import { getDb } from "@/db";
import { inventory, products } from "@/db/schema";
import { ensureCatalogInitialized } from "@/lib/catalog-service";
import { toCatalogListItem } from "@/lib/product-enrichment";
import { asc, eq } from "drizzle-orm";

export async function GET() {
  await ensureCatalogInitialized();
  const rows = await getDb().select({ product: products, stock: inventory.onHand }).from(products).leftJoin(inventory, eq(inventory.productId, products.id)).where(eq(products.status, "published")).orderBy(asc(products.name));
  // The list keeps its existing shape; heavy/internal enrichment columns (gallery, specifications, documents, warranty, source url) are never spread into it.
  return Response.json({ products: rows.map(({ product, stock }) => toCatalogListItem(product, stock)) });
}
