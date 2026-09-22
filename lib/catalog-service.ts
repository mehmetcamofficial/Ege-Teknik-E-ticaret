import { getDb } from "@/db";
import { brands, categories, inventory, products } from "@/db/schema";
import { catalogDefaults } from "@/lib/catalog-defaults";
import { count } from "drizzle-orm";

export async function ensureCatalogInitialized() {
  const db = getDb();
  const [result] = await db.select({ value: count() }).from(products);
  if (result.value > 0) return { inserted: 0, total: result.value };

  const brandId = "gree";
  await db.insert(brands).values({ id: brandId, name: "GREE", slug: "gree" }).onConflictDoNothing();
  const categoryNames = [...new Set(catalogDefaults.map((item) => item.category))];
  await db.insert(categories).values(categoryNames.map((name) => ({ id: `category-${slugify(name)}`, name, slug: slugify(name) }))).onConflictDoNothing();
  await db.transaction(async (tx) => {
    for (const item of catalogDefaults) {
      const { stock, ...product } = item;
      await tx.insert(products).values({ ...product, brandId, categoryId: `category-${slugify(item.category)}` }).onConflictDoNothing();
      await tx.insert(inventory).values({ id: `inventory-${item.id}`, productId: item.id, onHand: stock }).onConflictDoNothing();
    }
  });

  const [updated] = await db.select({ value: count() }).from(products);
  return { inserted: updated.value, total: updated.value };
}

function slugify(value: string) {
  return value.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
