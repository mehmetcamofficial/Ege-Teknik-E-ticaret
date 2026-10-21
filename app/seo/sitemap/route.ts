import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/db";
import { products } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { isCustomerVisibleProduct } from "@/lib/catalog-visibility";
import { productCanonical, escapeHtml } from "@/lib/storefront-seo";
export const dynamic = "force-dynamic";
export async function GET() {
 try {
  const rows = await getDb().select({id:products.id}).from(products).where(eq(products.status,"published")).orderBy(asc(products.id));
  const base = await readFile(path.join(process.cwd(),"public/sitemap.xml"),"utf8");
  const urls = rows.filter(p=>isCustomerVisibleProduct(p.id)).map(p=>'<url><loc>'+escapeHtml(productCanonical(p.id))+'</loc></url>').join('\n');
  return new Response(base.replace('</urlset>',urls+'\n</urlset>'),{headers:{'content-type':'application/xml; charset=utf-8','cache-control':'no-store'}});
 } catch { return new Response('Sitemap temporarily unavailable',{status:503,headers:{'retry-after':'60','cache-control':'no-store'}}); }
}
