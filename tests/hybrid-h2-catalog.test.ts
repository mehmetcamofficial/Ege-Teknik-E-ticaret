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
  assert.match(h2Css, /\.product-visual\{aspect-ratio:16\/10/);
  assert.match(h2Css, /@media\(prefers-reduced-motion:reduce\)\{[^@]*transform:none/);
  assert.match(h2Css, /@media\(max-width:560px\)\{[^@]*grid-template-columns:minmax\(118px,40%\) minmax\(0,1fr\)/);
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

/* ---------- H2-C product detail ---------- */
async function productPage(detail: Record<string, unknown>, catalog: Record<string, unknown>[]) {
  const root = fakeElement();
  const store = loadStorefront({ path: "product.html", search: `?id=${encodeURIComponent(String(detail.id))}`, elements: { "[data-product-page]": root }, api: { products: catalog, detail } });
  await store.fn<() => Promise<void>>("loadCatalog")();
  return { root, store };
}

test("H2 series options link each sibling to its own page with its own API price; current page uses the detail price", async () => {
  const catalog = [
    apiProduct({ id: "a9", name: "Airy 9000 BTU/h", series: "Airy", capacity: "9000 BTU/h", price: 55_100, stock: 4 }),
    apiProduct({ id: "a12s", name: "Airy 12000 BTU/h - Siyah", series: "Airy", capacity: "12000 BTU/h", price: 60_000, stock: 4 }),
    apiProduct({ id: "a18", name: "Airy 18000 BTU/h", series: "Airy", capacity: "18000 BTU/h", price: 83_250, stock: 0 }),
    apiProduct({ id: "f9", name: "Fairy 9000 BTU/h", series: "Fairy", capacity: "9000 BTU/h", price: 40_000 }),
  ];
  const { root } = await productPage(apiProduct({ id: "a12s", name: "Airy 12000 BTU/h - Siyah", series: "Airy", capacity: "12000 BTU/h", price: 61_400, stock: 10 }), catalog);
  const html = root.innerHTML, money = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
  assert.match(html, /<p class="pd-variants-title" id="pd-variants-title">Airy seçenekleri<\/p>/);
  assert.match(html, new RegExp(`href="product\\.html\\?id=a9"><span>9\\.000 BTU/h</span><small>${money(55_100)}</small>`));
  assert.match(html, new RegExp(`class="pd-variant is-current" href="product\\.html\\?id=a12s" aria-current="page"><span>12\\.000 BTU/h · Siyah</span><small>${money(61_400)}</small>`), "the current option shows the detail endpoint price, not the list copy");
  assert.match(html, /class="pd-variant is-out" href="product\.html\?id=a18"><span>18\.000 BTU\/h<\/span><small>Stokta yok<\/small>/);
  const variants = html.slice(html.indexOf("pd-variants"), html.indexOf("</ul>", html.indexOf("pd-variants")));
  assert.doesNotMatch(variants, /id=f9/, "another series is never offered as a variant");
});

test("H2 generic 'GREE' series and singletons get no variant picker", async () => {
  const lone = await productPage(apiProduct({ id: "x", series: "Airy" }), [apiProduct({ id: "x", series: "Airy" })]);
  assert.doesNotMatch(lone.root.innerHTML, /pd-variants/);
  const generic = await productPage(apiProduct({ id: "g1", series: "GREE" }), [apiProduct({ id: "g1", series: "GREE" }), apiProduct({ id: "g2", series: "GREE" })]);
  assert.doesNotMatch(generic.root.innerHTML, /pd-variants/);
});

test("H2 product information table uses only stored fields when verified specs are missing", async () => {
  const { root } = await productPage(apiProduct({ id: "i", name: "Airy 12000 BTU/h - Siyah", series: "Airy", sku: "", specifications: [] }), [apiProduct({ id: "i" })]);
  assert.match(root.innerHTML, /id="bilgiler"[\s\S]*<dt>Kategori<\/dt><dd>Duvar Tipi<\/dd>[\s\S]*<dt>Renk<\/dt><dd>Siyah<\/dd>[\s\S]*<dt>Satış şekli<\/dt><dd>Online satış<\/dd>/);
  assert.doesNotMatch(root.innerHTML.slice(root.innerHTML.indexOf('id="bilgiler"')), /<dt>Model kodu<\/dt>/, "an empty SKU is not listed as a row");
  assert.match(root.innerHTML, /<a href="#bilgiler">Ürün bilgileri<\/a>/);
});

test("H2 gallery step buttons wrap through the approved gallery", async () => {
  const gallery = [1, 2, 3].map((n) => ({ url: `https://www.gree.com.tr/g${n}.png`, alt: `G${n}`, width: 1600, height: 900 }));
  const { root, store } = await productPage(apiProduct({ id: "g", gallery, imageUrl: gallery[0].url }), [apiProduct({ id: "g" })]);
  assert.match(root.innerHTML, /data-action="gallery-step" data-step="-1" aria-label="Önceki görsel"/);
  assert.match(root.innerHTML, /data-action="gallery-step" data-step="1" aria-label="Sonraki görsel"/);
  assert.ok(store);
  assert.match(readFileSync("public/store-core.js", "utf8"), /action==='gallery-step'\)\{const count=approvedGallery\(productDetail\)\.length;if\(count\)selectProductGallery\(\(selectedGalleryIndex\+Number\(el\.dataset\.step\|\|0\)\+count\)%count\)\}/);
});

test("H2 sticky buy bar also opens after a jump past the buy box (observer-only missed it)", () => {
  const core = readFileSync("public/store-core.js", "utf8");
  assert.match(core, /function checkStickyBuy\(\)\{stickyScrollQueued=false;const box=document\.querySelector\('\.pd-buy'\);const past=!!box&&box\.getBoundingClientRect\(\)\.bottom<0;/);
  assert.match(core, /window\.addEventListener\('scroll',\(\)=>\{if\(!stickyScrollQueued\)\{stickyScrollQueued=true;requestAnimationFrame\(checkStickyBuy\)\}\},\{passive:true\}\)/);
});

test("H2 filter drawer pulls focus back when a browser's Tab order skips the last button (Safari default)", () => {
  assert.match(readFileSync("public/store-core.js", "utf8"), /else setTimeout\(\(\)=>\{if\(panel\.classList\.contains\('open'\)&&!panel\.contains\(document\.activeElement\)\)\(event\.shiftKey\?controls\.at\(-1\):controls\[0\]\)\?\.focus\(\)\},0\);/);
});

/* ---------- H2.1 final polish ---------- */
test("H2.1 help launcher steps aside from price, stock and buying controls, never while open or focused", () => {
  const core = readFileSync("public/store-core.js", "utf8"), css = readFileSync("public/store.css", "utf8");
  for (const sel of [".pd-offer", ".pd-buy .purchase-row", ".pd-sticky.is-visible", "[data-products] .product-foot", "[data-products] .product .actions"]) assert.ok(core.includes(sel), sel);
  assert.match(core, /getAttribute\('aria-expanded'\)==='true'\|\|wrap\.contains\(document\.activeElement\)\)\{clearTimeout\(helpShowTimer\);helpShowTimer=null;wrap\.classList\.remove\('is-clearing'\)/);
  assert.match(css, /\.help-launcher\.is-clearing,html\.nav-open \.help-launcher,html\.cart-drawer-open \.help-launcher,body:has\(\[data-cookie-banner\]\) \.help-launcher\{opacity:0;visibility:hidden;pointer-events:none\}/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\.help-launcher\{transition:none\}\}/);
});

test("H2.1 phone product keeps the gallery help as an accessible description, only visually hidden", () => {
  assert.match(h2Css, /\.pd-gallery-help\{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect\(0 0 0 0\)/);
  assert.doesNotMatch(h2Css, /\.pd-gallery-help\{display:none/);
});
