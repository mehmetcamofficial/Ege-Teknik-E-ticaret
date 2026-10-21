/**
 * H2 premium catalog: cards show only facts the catalog API carries, availability comes from saleMode and stock,
 * and colour is read only from a colour word in the product name.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { apiProduct, fakeElement, loadStorefront } from "./support/storefront-sandbox.ts";

const h2Css = readFileSync("public/catalog-h2.css", "utf8");
const card = () => loadStorefront().fn<(p: unknown, o?: unknown) => string>("productCard");
const base = { id: "c1", name: "Airy 12000 BTU/h", series: "Airy", category: "Duvar Tipi", sku: "", capacity: "12000 BTU/h", sale: true, price: 58_400, stock: 10, imageUrl: "" };

test("H2 card availability is derived from saleMode and stock only", () => {
  const render = card();
  assert.match(render(base), /class="product-media" data-availability="in"/);
  assert.match(render({ ...base, stock: 2 }), /data-availability="low"[\s\S]*class="stock-line is-in is-low">Stokta · 2 adet</);
  assert.match(render({ ...base, stock: 0 }), /data-availability="out"[\s\S]*class="stock-line is-out">Stokta yok<[\s\S]*class="primary" disabled>Tükendi</);
  const quote = render({ ...base, sale: false, price: 0, stock: 0 });
  assert.match(quote, /data-availability="quote"/);
  assert.doesNotMatch(quote, /data-action="add-cart"|Stokta/, "a quote product never looks purchasable or stocked");
});

test("H2 catalog cards do not print missing-data placeholders", () => {
  const html = card()(base);
  assert.doesNotMatch(html, /paylaşılmamış/i);
  assert.match(readFileSync("public/store-core.js", "utf8"), /productCard\(p,\{eager:index<3,priority:index===0\?'high':undefined\}\)/);
});

test("H2 colour chip appears only when the name carries a colour word", () => {
  const render = card();
  assert.match(render({ ...base, name: "Airy 12000 BTU/h - Siyah" }), /<span class="spec colour">Siyah<\/span>/);
  assert.match(render({ ...base, name: "Fairy 9000 BTU/h – Beyaz" }), /<span class="spec colour">Beyaz<\/span>/);
  assert.doesNotMatch(render(base), /spec colour/);
  assert.doesNotMatch(render({ ...base, name: "Grisoft 9000" }), /spec colour/, "whole words only");
});

test("H2 stylesheet keeps consistent media ratio, reduced-motion and phone layout", () => {
  assert.match(h2Css, /\.product-visual\{aspect-ratio:4\/3/);
  assert.match(h2Css, /@media\(prefers-reduced-motion:reduce\)\{[^@]*transform:none/);
  assert.match(h2Css, /@media\(max-width:560px\)\{[^@]*grid-template-columns:minmax\(112px,36%\) minmax\(0,1fr\)/);
  for (const page of ["catalog", "product"]) assert.match(readFileSync(`public/${page}.html`, "utf8"), /href="catalog-h2\.css"/);
});

/* ---------- H2-B smart filters ---------- */
const filterItems = [
  { id: "s", name: "Airy 12000 BTU/h - Siyah", brandId: "gree", series: "Airy", category: "Duvar Tipi", capacity: "12000 BTU/h", sale: true, stock: 4, price: 61_400 },
  { id: "w", name: "Fairy 9000 BTU/h – Beyaz", brandId: "gree", series: "Fairy", category: "Duvar Tipi", capacity: "9000 BTU/h", sale: true, stock: 0, price: 40_000 },
  { id: "q", name: "Multi İç Ünite", brandId: "gree", series: "Multi", category: "Multi Sistem", capacity: "12000 BTU/h", sale: false, stock: 0, price: 0 },
];

test("H2 colour and availability filters use only real fields", () => {
  const select = loadStorefront().fn<(p: unknown[], f: Record<string, string>) => { id: string }[]>("selectCatalogProducts");
  const ids = (f: Record<string, string>) => Array.from(select(filterItems, f), (p) => p.id);
  assert.deepEqual(ids({ colour: "Siyah" }), ["s"]);
  assert.deepEqual(ids({ colour: "Beyaz" }), ["w"]);
  assert.deepEqual(ids({ stock: "quote" }), ["q"]);
  assert.deepEqual(ids({ stock: "available" }), ["s"]);
  assert.deepEqual(ids({ stock: "unavailable" }), ["w"], "an online item with no stock is out of stock, never a quote item");
});

test("H2 empty result offers only relaxations that actually return products, with real counts", async () => {
  const grid = fakeElement(), series = { ...fakeElement(), value: "Airy", dataset: { catalogFilter: "series" } }, stock = { ...fakeElement(), value: "unavailable", dataset: { catalogFilter: "stock" } };
  const products = [apiProduct({ id: "a", name: "Airy A", series: "Airy", stock: 5 }), apiProduct({ id: "b", name: "Airy B", series: "Airy", stock: 2 }), apiProduct({ id: "f", name: "Fairy", series: "Fairy", stock: 0 })];
  const store = loadStorefront({ path: "catalog.html", elements: { "[data-products]": grid, '[data-catalog-filter="series"]': series, '[data-catalog-filter="stock"]': stock }, api: { products } });
  await store.fn<() => Promise<void>>("loadCatalog")();
  assert.match(grid.innerHTML, /Bu filtrelerle eşleşen ürün bulunamadı/);
  assert.match(grid.innerHTML, /2 filtre birlikte uygulandı/);
  assert.match(grid.innerHTML, /data-action="remove-filter" data-key="stock"><span>Uygunluk: Stokta yok kaldır<\/span><b>2 ürün<\/b>/);
  assert.match(grid.innerHTML, /data-action="remove-filter" data-key="series"><span>Seri: Airy kaldır<\/span><b>1 ürün<\/b>/);
  assert.match(grid.innerHTML, /class="primary" data-action="clear-catalog">Filtreleri temizle/);
});

test("H2 a filter whose single value covers every product is hidden; a narrowing one stays", async () => {
  const group = (hidden = false) => ({ hidden }), brandGroup = group(), wifiGroup = group();
  const brand = { ...fakeElement(), dataset: { catalogFilter: "brand" }, closest: () => brandGroup }, wifi = { ...fakeElement(), dataset: { catalogFilter: "wifi" }, closest: () => wifiGroup };
  const products = [apiProduct({ id: "a", brandId: "gree", wifi: "Dahili" }), apiProduct({ id: "b", brandId: "gree", wifi: "" })];
  await loadStorefront({ path: "catalog.html", elements: { '[data-catalog-filter="brand"]': brand, '[data-catalog-filter="wifi"]': wifi }, api: { products } }).fn<() => Promise<void>>("loadCatalog")();
  assert.equal(brandGroup.hidden, true);
  assert.equal(wifiGroup.hidden, false);
});

test("H2 catalog markup carries colour and availability controls", () => {
  const html = readFileSync("public/catalog.html", "utf8");
  assert.match(html, /<span>Renk<\/span><select data-catalog-filter="colour">/);
  assert.match(html, /<option value="quote">Teklif \/ keşif ürünleri<\/option>/);
});
