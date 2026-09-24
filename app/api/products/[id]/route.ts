import { getDb } from "@/db";
import { inventory, products } from "@/db/schema";
import { toPublicProductDetail } from "@/lib/product-enrichment";
import { and, eq } from "drizzle-orm";

/**
 * Public, read-only product detail for the premium product page. Only published products; only approved display data:
 * verified specifications, approved documents and gallery, and a safe warranty presentation. Internal review metadata, partial values,
 * raw warranty values and the official source URL are never returned.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (id.length < 1 || id.length > 200) return Response.json({ error: "Ürün bulunamadı." }, { status: 404 });
  const [row] = await getDb().select({ product: products, stock: inventory.onHand }).from(products).leftJoin(inventory, eq(inventory.productId, products.id)).where(and(eq(products.id, id), eq(products.status, "published"))).limit(1);
  if (!row) return Response.json({ error: "Ürün bulunamadı." }, { status: 404, headers: { "cache-control": "no-store" } });
  return Response.json({ product: toPublicProductDetail(row.product, row.stock) }, { headers: { "cache-control": "no-store" } });
}
