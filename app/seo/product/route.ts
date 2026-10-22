import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/db";
import { products, inventory } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { isCustomerVisibleProduct } from "@/lib/catalog-visibility";
import { correctedProductImage } from "@/lib/product-image-corrections";
import { renderProductHead } from "@/lib/storefront-seo";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") || "";
  const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };
  if (!id || id.length > 200 || !isCustomerVisibleProduct(id)) return new Response('<!doctype html><html lang="tr"><meta name="robots" content="noindex"><title>Ürün bulunamadı | Ege Teknik</title><h1>Ürün bulunamadı</h1><a href="/catalog.html">Ürünlere dön</a></html>', { status: 404, headers });
  try {
    const [row] = await getDb().select({product:products,stock:inventory.onHand}).from(products).leftJoin(inventory,eq(inventory.productId,products.id)).where(and(eq(products.id,id),eq(products.status,"published"))).limit(1);
    if (!row) return new Response('Ürün bulunamadı', { status: 404, headers: { ...headers, "x-robots-tag": "noindex" } });
    const p=row.product;
    return new Response(renderProductHead(await readFile(path.join(process.cwd(),"public/product.html"),"utf8"),{...p,stock:row.stock,imageUrl:String(correctedProductImage(p.id,p.imageUrl))}), { headers });
  } catch { return new Response('Ürün bilgileri geçici olarak alınamıyor.', { status: 503, headers: { ...headers, "x-robots-tag": "noindex", "retry-after": "60" } }); }
}
