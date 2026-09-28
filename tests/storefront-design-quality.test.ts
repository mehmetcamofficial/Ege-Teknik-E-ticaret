/**
 * Paket 1C storefront quality: one shared product card with every buying fact, a catalog that pages and
 * shows removable active filters, a homepage bound to real (non-blocked) catalog products and local assets,
 * and a product page that supports the purchase decision (favourite/compare, section navigation, verified highlights).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import test from "node:test";
import review from "../data/catalog-enrichment/catalog-enrichment.v1.json" with { type: "json" };
import { apiProduct, fakeElement, loadStorefront, storefrontCoreSource } from "./support/storefront-sandbox.ts";

const home = readFileSync("public/index.html", "utf8");
const css = readFileSync("public/store.css", "utf8");
const blocked = new Set(review.decisions.filter((d) => d.importStatus.startsWith("BLOCKED_")).map((d) => d.productId));
const money = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);

test("the shared product card carries series, name, model, capacity, energy, Wi-Fi, price, stock and every action", () => {
  const card = loadStorefront().fn<(p: unknown) => string>("productCard");
  const html = card({ id: "c1", name: "Airy 12000 BTU/h", series: "Airy", category: "Duvar Tipi", sku: "GWH12AVCXD-K6DNA1A-W", capacity: "12000 BTU/h", energy: "A+++ / A++", wifi: "Var", sale: true, price: 58_400, stock: 4, imageUrl: "https://www.gree.com.tr/a.png" });
  assert.match(html, /^<article class="product">/);
  assert.match(html, /<div class="meta">Airy · Duvar Tipi<\/div>/);
  assert.match(html, /<h3><a href="product\.html\?id=c1">Airy 12000 BTU\/h<\/a><\/h3>/);
  assert.match(html, /Model <b>GWH12AVCXD-K6DNA1A-W<\/b>/);
  assert.match(html, /<span class="spec btu">12\.000 BTU\/h<\/span>/, "capacity is shown with a thousands separator");
  assert.match(html, /A\+\+\+ \/ A\+\+<\/span>/);
  assert.match(html, /<span class="spec">Wi-Fi<\/span>/);
  assert.ok(html.includes(money(58_400)));
  assert.match(html, /KDV dahil/);
  assert.match(html, /class="stock-line is-in">Stokta · 4 adet</);
  assert.match(html, /data-action="toggle-favorite" data-id="c1"/);
  assert.match(html, /data-action="toggle-compare" data-id="c1"/);
  assert.match(html, /data-action="add-cart" data-id="c1">Sepete Ekle</);
  assert.match(html, /<a class="ghost" href="product\.html\?id=c1">İncele<\/a>/);
  assert.match(html, /<img class="product-image" src="https:\/\/www\.gree\.com\.tr\/a\.png" alt="Airy 12000 BTU\/h"[^>]*loading="lazy">/);
});

test("quote-only products say so on the card instead of showing a price or stock count", () => {
  const html = loadStorefront().fn<(p: unknown) => string>("productCard")({ id: "q1", name: "Multi İç Ünite", series: "Amber", category: "Multi Sistem", capacity: "9000 BTU/h", sale: false, price: 0, stock: 0, imageUrl: "" });
  assert.match(html, /Fiyat Sor<small>Projelendirme ile satılır<\/small>/);
  assert.match(html, /class="stock-line is-quote">Keşif sonrası teklif</);
  assert.match(html, /data-action="quote" data-id="q1">Teklif Al</);
  assert.doesNotMatch(html, /₺/);
});

test("the catalog pages 24 products at a time and a load-more control reveals the rest", async () => {
  const grid = fakeElement(), more = fakeElement();
  const products = Array.from({ length: 30 }, (_, i) => apiProduct({ id: `p${i}`, name: `Ürün ${String(i).padStart(2, "0")}` }));
  const store = loadStorefront({ path: "catalog.html", elements: { "[data-products]": grid, "[data-load-more]": more }, api: { products } });
  await store.fn<() => Promise<void>>("loadCatalog")();
  assert.equal((grid.innerHTML.match(/<article class="product">/g) ?? []).length, 24);
  assert.match(more.innerHTML, /24 \/ 30 ürün gösteriliyor/);
  assert.match(more.innerHTML, /data-action="load-more"/);
  store.fn<(e: unknown) => void>("handleDelegatedClick")({ target: { closest: (sel: string) => (sel === "[data-action]" ? { dataset: { action: "load-more" } } : null) } });
  assert.equal((grid.innerHTML.match(/<article class="product">/g) ?? []).length, 30);
  assert.equal(more.innerHTML, "");
});

test("active filters are removable buttons with a clear-all control, and removing one re-renders the list", async () => {
  const grid = fakeElement(), active = fakeElement(), series = { ...fakeElement(), value: "Airy", dataset: { catalogFilter: "series" } }, stock = { ...fakeElement(), value: "available", dataset: { catalogFilter: "stock" } };
  const products = [apiProduct({ id: "a", name: "Airy Ürün", series: "Airy" }), apiProduct({ id: "f", name: "Fairy Ürün", series: "Fairy" })];
  const store = loadStorefront({ path: "catalog.html", elements: { "[data-products]": grid, "[data-active-filters]": active, '[data-catalog-filter="series"]': series, '[data-catalog-filter="stock"]': stock }, api: { products } });
  await store.fn<() => Promise<void>>("loadCatalog")();
  assert.match(grid.innerHTML, /Airy Ürün/);
  assert.doesNotMatch(grid.innerHTML, /Fairy Ürün/);
  assert.match(active.innerHTML, /<button type="button" class="active-chip spec" data-action="remove-filter" data-key="series"><span>Seri:<\/span> Airy/);
  assert.match(active.innerHTML, /data-key="stock"><span>Stok:<\/span> Stokta/);
  assert.match(active.innerHTML, /data-action="clear-catalog">Tümünü temizle/);
  store.fn<(key: string) => void>("removeCatalogFilter")("series");
  assert.equal(series.value, "");
  assert.match(grid.innerHTML, /Fairy Ürün/);
});

test("before the catalog answers, the grid shows same-size skeleton cards with a spoken loading status", () => {
  const grid = fakeElement();
  loadStorefront({ path: "catalog.html", elements: { "[data-products]": grid }, api: { products: "pending" } }).fn<() => void>("renderCatalog")();
  assert.match(grid.innerHTML, /<p class="sr-only" role="status">Ürün bilgileri yükleniyor…<\/p>/);
  assert.equal((grid.innerHTML.match(/product-skeleton/g) ?? []).length, 6);
});

test("every homepage product binding is a real, customer-visible catalog product (never one of the blocked nine)", () => {
  const ids = new Set([...home.matchAll(/data-(?:featured-product|product|id)="([^"]+)"/g)].map((m) => m[1]));
  assert.ok(ids.size >= 9);
  for (const id of ids) {
    assert.ok(!blocked.has(id), `${id} is BLOCKED and must not be on the storefront`);
    assert.ok(review.baseline[id as keyof typeof review.baseline], `${id} is not a known catalog product`);
  }
});

test("series and capacity discovery figures are computed from the served catalog, never typed into the page", () => {
  assert.doesNotMatch(home.replace(/<script[\s\S]*?<\/script>/g, ""), /₺\s?\d|\d\s?₺/);
  for (const series of ["Airy", "Fairy", "Pular", "Aphro"]) assert.match(home, new RegExp(`data-series-card="${series}"`));
  for (const field of ["range", "energy", "from", "count", "use"]) assert.match(home, new RegExp(`data-series-field="${field}"`));
  for (const btu of ["9000", "12000", "18000", "24000"]) assert.match(home, new RegExp(`data-need-btu="${btu}"`));
  assert.match(storefrontCoreSource(), /function renderHomeDiscovery\(\)\{[^\n]*?if\(!catalogAuthoritative\(\)\)return;const products=getProducts\(\)/);
  assert.doesNotMatch(home, /\d+\s*[-–]\s*\d+\s*m²/, "no square-metre promise per capacity");
});

test("storefront pages load no third-party stylesheet, font or script; fonts and homepage images are local files", () => {
  for (const page of readdirSync("public").filter((f) => f.endsWith(".html"))) {
    const html = readFileSync(`public/${page}`, "utf8");
    assert.doesNotMatch(html.replace(/<link rel="canonical"[^>]*>/, ""), /<link[^>]+href="https?:\/\//, `${page} links an external stylesheet/preload`);
    assert.doesNotMatch(html, /<script[^>]+src="https?:\/\//, `${page} loads an external script`);
  }
  for (const m of css.matchAll(/url\(([^)]+)\)/g)) assert.ok(existsSync(`public${m[1]}`), `missing ${m[1]}`);
  for (const m of home.matchAll(/(?:src|srcset|href)="(\/assets\/[^" ]+)/g)) {
    assert.ok(existsSync(`public${m[1]}`), `missing ${m[1]}`);
    assert.ok(statSync(`public${m[1]}`).size < 120_000, `${m[1]} is larger than an optimized web asset should be`);
  }
});

test("the product page offers favourite and compare, section navigation and only verified spec highlights", async () => {
  const root = fakeElement();
  const product = apiProduct({ id: "d1", series: "Airy", specifications: [
    { key: "capacity_btu", label: "Kapasite", value: "12000", unit: "BTU/h" },
    { key: "energy_class", label: "Sezonsal enerji sınıfı", value: "A+++ / A++", unit: null },
    { key: "seer", label: "SEER", value: "8,5", unit: null },
    { key: "refrigerant", label: "Soğutucu akışkan", value: "R32", unit: null },
  ] });
  await loadStorefront({ path: "product.html", search: "?id=d1", elements: { "[data-product-page]": root }, api: { products: [product] } }).fn<() => Promise<void>>("loadCatalog")();
  const html = root.innerHTML;
  assert.match(html, /class="pd-toggle" data-action="toggle-favorite" data-id="d1" aria-pressed="false"/);
  assert.match(html, /class="pd-toggle" data-action="toggle-compare" data-id="d1" aria-pressed="false"/);
  assert.match(html, /<nav class="pd-nav" aria-label="Ürün bölümleri">/);
  assert.match(html, /<ul class="pd-highlights" aria-label="Öne çıkan özellikler"><li><span>Kapasite<\/span><b>12\.000 <small>BTU\/h<\/small><\/b><\/li>/);
  assert.match(html, /<li><span>SEER<\/span><b>8,5<\/b><\/li>/);
  assert.match(html, /<span>Seri<\/span><b>Airy<\/b>/);
});

// ---- Paket 1D: content integrity, contact, selector, map ----------------------------------------------------------

test("the shared stylesheets are syntactically balanced (an unclosed block silently drops every later rule)", () => {
  for (const file of ["public/store.css", "public/product-detail.css"]) {
    const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    let depth = 0;
    for (const ch of src) { if (ch === "{") depth++; else if (ch === "}") depth--; assert.ok(depth >= 0, `${file}: stray }`); }
    assert.equal(depth, 0, `${file}: unclosed {`);
  }
});

test("the smart selector reuses one estimator: range near a class boundary and an on-site survey for large or commercial spaces", () => {
  const field = (value: string) => ({ ...fakeElement(), value });
  const run = (values: Record<string, string>) => {
    const out = { ...fakeElement(), classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => true } };
    const elements: Record<string, ReturnType<typeof fakeElement>> = { "[data-selector-result]": out };
    for (const [k, v] of Object.entries(values)) elements[`#sel-${k}`] = field(v);
    loadStorefront({ path: "selector.html", elements }).fn<() => void>("calculateBtu")();
    return out.innerHTML;
  };
  const small = run({ area: "16", sun: "1", ins: "1", people: "2", type: "yatak", city: "aydin" });
  assert.match(small, /<b>9\.000 BTU\/h<\/b>/);
  assert.match(small, /href="catalog\.html\?btu=9000"/);
  assert.doesNotMatch(small, /Yerinde keşif önerilir/);
  assert.match(run({ area: "34", sun: "1", ins: "1", people: "3", type: "salon", city: "izmir" }), /18\.000 – 24\.000 BTU\/h[\s\S]*Yerinde keşif önerilir/);
  const shop = run({ area: "40", sun: "1", ins: "1", people: "2", type: "magaza", city: "mugla" });
  assert.match(shop, /Yerinde keşif önerilir:<\/b> ticari kullanımda/);
  assert.match(shop, /href="contact\.html\?subject=kesif&city=mugla"/);
  const big = run({ area: "90", sun: "1.2", ins: "1.2", people: "6", type: "salon", city: "aydin" });
  assert.match(big, /24\.000 BTU\/h üzeri/);
  assert.doesNotMatch(big, /catalog\.html\?btu=/, "no single-unit capacity is recommended beyond the wall-unit range");
  assert.match(home, /data-btu-selector/);
  assert.match(readFileSync("public/selector.html", "utf8"), /data-btu-selector/);
});

test("service requests accept e-mail or phone, and refuse a request with neither", async () => {
  const { serviceRequestSchema } = await import("../lib/service-request-schema.ts");
  const base = { type: "kesif", name: "Ada Yılmaz", city: "Kuşadası", message: "Keşif talebi" };
  assert.equal(serviceRequestSchema.safeParse({ ...base, email: "ada@example.com" }).success, true);
  assert.equal(serviceRequestSchema.safeParse({ ...base, phone: "05001112233" }).success, true);
  assert.equal(serviceRequestSchema.safeParse({ ...base, phone: "", email: "" }).success, false);
  assert.equal(serviceRequestSchema.safeParse({ ...base, email: "not-an-email" }).success, false);
});

test("e-mail is a first-class contact action in the header, footer, contact page and help menu; WhatsApp is secondary", () => {
  const js = storefrontCoreSource(), contact = readFileSync("public/contact.html", "utf8");
  assert.match(js, /<div class="top-links"><a href="mailto:\$\{business\.email\}">/);
  const footer = /function renderFooter\(\)\{[^\n]*/.exec(js)?.[0] ?? "";
  assert.match(footer, /mailto:\$\{business\.email\}/);
  assert.doesNotMatch(footer, /business\.wa/, "the footer no longer pushes WhatsApp as the contact route");
  assert.match(contact, /<a class="contact-card contact-action" href="mailto:info@egeteknik\.tr">/);
  assert.match(contact, /<input name="email" type="email"/);
  assert.match(contact, /Telefon \(isteğe bağlı\)<input name="phone"/);
  assert.doesNotMatch(js, /location\.href=business\.wa/, "the form never redirects to WhatsApp on its own");
});

test("the help launcher is a real contact menu with an assistant mount point, and makes no AI claim", () => {
  const js = storefrontCoreSource();
  const launcher = /function renderHelpLauncher\(\)\{[^\n]*/.exec(js)?.[0] ?? "";
  assert.match(launcher, /aria-expanded="false" aria-controls="help-panel"/);
  assert.match(launcher, /id="ege-assistant-root" data-assistant-slot/);
  assert.match(launcher, /window\.EgeAssistant=/);
  assert.doesNotMatch(launcher, /yapay zeka|\bAI\b|asistan aktif|chatbot/i);
});

test("the service-area map covers exactly the nine service provinces and credits its map data", () => {
  for (const page of ["public/index.html", "public/contact.html", "public/regions.html"]) {
    const html = readFileSync(page, "utf8");
    const provinces = [...html.matchAll(/data-map-province="([a-z]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(provinces, ["afyonkarahisar", "aydin", "balikesir", "denizli", "izmir", "kutahya", "manisa", "mugla", "usak"], page);
    assert.match(html, /Harita verisi © OpenStreetMap katkıda bulunanlar \(ODbL\)/, page);
    assert.match(html, /<title id="map-title">/, page);
  }
});

test("product page tabs only point at sections that exist, and a quote product without extras has no dead tab", async () => {
  const root = fakeElement();
  const bare = apiProduct({ id: "q2", saleMode: "quote", price: 0, category: "Multi Sistem", capacity: "9000 BTU/h", description: "", shortDescription: null, specifications: [], documents: [], warranty: null });
  await loadStorefront({ path: "product.html", search: "?id=q2", elements: { "[data-product-page]": root }, api: { products: [bare] } }).fn<() => Promise<void>>("loadCatalog")();
  const html = root.innerHTML;
  const tabs = [...html.matchAll(/<nav class="pd-nav"[\s\S]*?<\/nav>/g)][0]?.[0] ?? "";
  for (const [, id] of tabs.matchAll(/href="#([a-z-]+)"/g)) assert.match(html, new RegExp(`id="${id}"`), `tab #${id} has no section`);
  assert.doesNotMatch(tabs, /#belgeler|#teknik|#ozellikler/);
  assert.doesNotMatch(html, /★/, "no stars without real reviews");
});
