/**
 * H3 premium cart & checkout: the drawer stays a view over ege-cart/writeCart, explains each line problem,
 * never prints missing-data placeholders and keeps focus inside the modal.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ux = readFileSync("public/store-ux.js", "utf8");
const core = readFileSync("public/store-core.js", "utf8");

test("H3-A drawer is still a view over ege-cart/writeCart, with no second cart store", () => {
  assert.doesNotMatch(ux, /localStorage\.setItem/);
  assert.match(ux, /cartLines\(getCart\(\),getProducts\(\)\)/);
  assert.match(core, /function writeCart\(entries\)\{\n try\{localStorage\.setItem\('ege-cart',JSON\.stringify\(normalizeCartEntries\(entries,null\)\)\)\}/);
  assert.match(core, /updateCartCount\(\);invalidateLegalPreview\(\);cartDrawer\(\)\?\.refresh\(\);return true/, "every cart write still invalidates the legal preview");
});

test("H3-A each line problem has its own message, and an over-stock line offers a one-tap fix", () => {
  for (const text of ["Bu ürün katalogda bulunamadı", "artık online satışta değil", "Ürün fiyatı doğrulanamadı", "Bu ürün stokta kalmadı", "Stokta ${limit} adet var. Adedi ${limit} veya daha az yapın."]) assert.ok(ux.includes(text), text);
  assert.match(ux, /data-drawer-action="fix" data-cart-id="\$\{id\}">Adedi \$\{limit\} yap<\/button>/);
  assert.match(ux, /else if\(control\.dataset\.drawerAction==='fix'\)\{const p=getProducts\(\)\.find\(x=>x\.id===id\);if\(p&&changeCartQuantity\(id,productQuantityLimit\(p\.stock\)\)\)/);
  assert.match(ux, /role="alert"/);
});

test("H3-A drawer shows counts and VAT, states delivery honestly and never prints placeholders", () => {
  assert.match(ux, /`\$\{lines\.length\} ürün · \$\{units\} adet`/);
  assert.match(ux, /<span>İçindeki KDV<\/span><span data-drawer-vat>—<\/span><span>Teslimat \/ montaj<\/span><span>Sipariş adımında gösterilir<\/span>/);
  assert.match(ux, /vat\.textContent=allValid\?money\(cartVat\(lines\)\):'—'/);
  assert.doesNotMatch(ux, /paylaşılmamış/);
  assert.match(ux, /Sipariş adımına geçmek için yukarıdaki uyarıları düzeltin\./);
});

test("H3-A focus restoration never drops to the page behind the modal", () => {
  assert.match(ux, /restore=body\.contains\(active\)\?\{action:active\.dataset\?\.drawerAction/);
  assert.match(ux, /\[data-drawer-action="quantity"\]'\)\]\.find\(el=>el\.dataset\.cartId===restore\.id/);
});
