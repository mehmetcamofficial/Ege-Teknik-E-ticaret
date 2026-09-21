import { getDb } from "@/db";
import { products } from "@/db/schema";
import { catalogDefaults } from "@/lib/catalog-defaults";
import { count } from "drizzle-orm";

// D1/SQLite limits the number of bound parameters per statement. Each product
// contributes many columns, so small batches keep the import safely below it.
const INSERT_BATCH_SIZE = 5;

export async function ensureCatalogInitialized() {
  const db = getDb();
  const [result] = await db.select({ value: count() }).from(products);
  if (result.value > 0) return { inserted: 0, total: result.value };

  for (let offset = 0; offset < catalogDefaults.length; offset += INSERT_BATCH_SIZE) {
    await db
      .insert(products)
      .values(catalogDefaults.slice(offset, offset + INSERT_BATCH_SIZE))
      .onConflictDoNothing();
  }

  const [updated] = await db.select({ value: count() }).from(products);
  return { inserted: updated.value, total: updated.value };
}
