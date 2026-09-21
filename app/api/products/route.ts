import { getDb } from "@/db";
import { products } from "@/db/schema";
import { ensureCatalogInitialized } from "@/lib/catalog-service";
import { asc, eq } from "drizzle-orm";

export async function GET() {
  await ensureCatalogInitialized();
  const rows = await getDb().select().from(products).where(eq(products.status, "published")).orderBy(asc(products.name));
  return Response.json({ products: rows });
}
