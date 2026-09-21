import { getDb } from "@/db";
import { products } from "@/db/schema";
import { asc, eq } from "drizzle-orm";

export async function GET() {
  const rows = await getDb().select().from(products).where(eq(products.status, "published")).orderBy(asc(products.name));
  return Response.json({ products: rows });
}
