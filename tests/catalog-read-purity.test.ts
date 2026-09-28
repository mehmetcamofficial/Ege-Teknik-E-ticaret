import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const publicProducts = readFileSync("app/api/products/route.ts", "utf8");
const importRoute = readFileSync("app/api/admin/catalog/import/route.ts", "utf8");
const catalogService = readFileSync("lib/catalog-service.ts", "utf8");

test("TD-02: public product GET is read-only even when the catalog is empty", () => {
  assert.doesNotMatch(publicProducts, /importCatalogDefaults|ensureCatalogInitialized/);
  assert.doesNotMatch(publicProducts, /\.insert\(|\.update\(|\.delete\(|\.transaction\(/);
  assert.match(publicProducts, /select\([\s\S]*from\(products\)/);
  assert.match(publicProducts, /Response\.json\(\{ products:/, "an empty SELECT still returns the valid { products: [] } shape");
});

test("catalog initialization is reachable only through the permission-checked explicit POST", () => {
  assert.match(importRoute, /export async function POST/);
  assert.match(importRoute, /getAdminUser\("catalog:write"\)/);
  assert.ok(importRoute.indexOf('getAdminUser("catalog:write")') < importRoute.indexOf("importCatalogDefaults()"));
  assert.doesNotMatch(importRoute, /export async function GET|export const GET/);
});

test("explicit catalog import is transactional and repeat-safe", () => {
  assert.match(catalogService, /export async function importCatalogDefaults/);
  assert.match(catalogService, /db\.transaction/);
  assert.equal((catalogService.match(/onConflictDoNothing\(/g) ?? []).length, 4, "brand, category, product and inventory inserts are idempotent");
  const transaction = catalogService.slice(catalogService.indexOf("db.transaction"));
  for (const table of ["brands", "categories", "products", "inventory"]) assert.match(transaction, new RegExp(`tx\\.insert\\(${table}\\)`));
});
