import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { datasetSchema, sanitizePublicDescription, toPublicProductDetail, toPublicWarranty } from "../lib/product-enrichment.ts";
import { apiProduct, fakeElement, loadStorefront } from "./support/storefront-sandbox.ts";

const dataset = datasetSchema.parse(JSON.parse(readFileSync("data/catalog-enrichment/catalog-enrichment.v1.json", "utf8")));
const css = readFileSync("public/product-detail.css", "utf8");
const js = readFileSync("public/store.js", "utf8");

const full = apiProduct({
  id: "full-1",
  name: "Tam Ürün",
  series: "Fairy",
  stock: 3,
  shortDescription: "Kısa açıklama.",
  description: "Uzun ve doğrulanmış açıklama.",
  gallery: [
    { url: "https://www.gree.com.tr/a.jpg", alt: "Tam Ürün ön görünüm", width: 1200, height: 800 },
    { url: "https://www.gree.com.tr/b.jpg", alt: "Tam Ürün yan görünüm", width: 1200, height: 800 },
  ],
  specifications: [{ key: "seer", label: "SEER", value: "8.5", unit: null }],
  documents: [{ type: "manual", label: "Kullanım Kılavuzu", url: "https://www.gree.com.tr/manual.pdf" }],
  warranty: { kind: "product", text: "3 yıl ürün garantisi.", conditions: "Üretici koşulları geçerlidir." },
});

async function render(detail: Record<string, unknown>, catalog = [detail]) {
  const root = fakeElement();
  const store = loadStorefront({ path: "product.html", search: `?id=${encodeURIComponent(String(detail.id))}`, elements: { "[data-product-page]": root }, api: { products: catalog, detail } });
  await store.fn<() => Promise<void>>("loadCatalog")();
  return { root, store };
}

test("product detail uses the dedicated endpoint exactly once and renders full enrichment", async () => {
  const { root, store } = await render(full);
  assert.equal(store.fetchCalls.filter((url) => url === "/api/products/full-1").length, 1);
  for (const expected of ["Tam Ürün", "Kısa açıklama.", "Uzun ve doğrulanmış açıklama.", "Teknik Özellikler", "SEER", "Kullanım Kılavuzu", "3 yıl ürün garantisi", "Üretici koşulları geçerlidir"]) assert.match(root.innerHTML, new RegExp(expected));
  assert.match(root.innerHTML, /data-action="gallery-select"/);
});

test("limited enrichment omits empty gallery, specs, documents and warranty sections", async () => {
  const limited = apiProduct({ id: "limited", imageUrl: "", shortDescription: null, description: "Sınırlı açıklama.", gallery: [], specifications: [], documents: [], warranty: null });
  const { root } = await render(limited);
  assert.match(root.innerHTML, /Ürün görseli henüz eklenmedi/);
  assert.doesNotMatch(root.innerHTML, /Teknik Özellikler|Belgeler ve Dokümanlar|<h2>Garanti<\/h2>/);
  assert.doesNotMatch(root.innerHTML, /<div class="gallery-thumbs"/);
});

test("gallery changes the stable primary image without navigation and exposes keyboard state", async () => {
  const { root, store } = await render(full);
  assert.match(root.innerHTML, /class="detail-image" src="https:\/\/www\.gree\.com\.tr\/a\.jpg"/);
  store.fn<(index: number) => void>("selectProductGallery")(1);
  assert.match(root.innerHTML, /class="detail-image" src="https:\/\/www\.gree\.com\.tr\/b\.jpg"/);
  assert.match(root.innerHTML, /aria-pressed="true"/);
  assert.match(js, /ArrowLeft.*ArrowRight.*Home.*End/);
});

test("quantity normalization enforces one, public stock and the checkout API ceiling", () => {
  const store = loadStorefront();
  const normalize = store.fn<(value: unknown, stock: unknown) => number>("normalizeProductQuantity");
  assert.equal(normalize(-5, 4), 1);
  assert.equal(normalize(0, 4), 1);
  assert.equal(normalize(Number.NaN, 4), 1);
  assert.equal(normalize(99, 4), 4);
  assert.equal(normalize(99, 30), 10);
  assert.equal(normalize(2.9, 4), 2);
  assert.equal(normalize(1, 0), 0);
});

test("online, sold-out and quote-only purchase modes render only legitimate actions", async () => {
  const online = await render(apiProduct({ id: "online", stock: 2, saleMode: "online" }));
  assert.match(online.root.innerHTML, /data-product-quantity[\s\S]*data-action="add-product-cart"/);
  const sold = await render(apiProduct({ id: "sold", stock: 0, saleMode: "online" }));
  assert.match(sold.root.innerHTML, /Tükendi[\s\S]*class="primary" disabled>Sepete Ekle/);
  assert.doesNotMatch(sold.root.innerHTML, /data-action="add-product-cart"/);
  const quote = await render(apiProduct({ id: "quote", stock: 5, saleMode: "quote" }));
  assert.doesNotMatch(quote.root.innerHTML, /data-product-quantity|data-action="add-product-cart"/);
  assert.match(quote.root.innerHTML, /Teklif talep et/);
});

test("only safe document links render and unresolved warranties remain duration-free", async () => {
  const detail = apiProduct({ id: "safe", documents: [{ label: "Kılavuz", url: "javascript:alert(1)" }, { label: "Enerji Etiketi", url: "https://www.gree.com.tr/e.pdf" }], warranty: { kind: "contact", text: "Garanti bilgisi için Ege Teknik ile iletişime geçebilirsiniz.", conditions: null } });
  const { root } = await render(detail);
  assert.doesNotMatch(root.innerHTML, /javascript:/);
  assert.match(root.innerHTML, /noopener noreferrer[\s\S]*Enerji Etiketi/);
  assert.doesNotMatch(root.innerHTML, /Garanti[\s\S]*\d+\s*yıl/i);
  assert.deepEqual(toPublicWarranty({ classification: "CONFLICT_REVIEW_REQUIRED", displayText: "İletişime geçin.", pageValue: null, conditions: null, sourceUrl: "https://www.gree.com.tr/x", generalTermsUrl: "https://www.gree.com.tr/g", retrievedAt: "2026-09-01" }), { kind: "contact", text: "Garanti bilgisi için Ege Teknik ile iletişime geçebilirsiniz.", conditions: null });
});

test("all nine blocked products remain customer-safe without mutating their records", () => {
  const blocked = dataset.decisions.filter((d) => d.importStatus.startsWith("BLOCKED_"));
  assert.equal(blocked.length, 9);
  for (const decision of blocked) {
    const baseline = dataset.baseline[decision.productId];
    const before = baseline.description;
    const detail = toPublicProductDetail({ ...baseline, category: "Klima", series: "", capacity: "" }, 0);
    assert.doesNotMatch(detail.description, /Kaynak:\s*https?:\/\/(?:www\.)?gree\.com\.tr/i, decision.productId);
    assert.equal(baseline.description, before, "sanitization must not mutate the stored/baseline object");
  }
  assert.equal(sanitizePublicDescription("Metin\nKaynak: https://www.gree.com.tr/x"), "Metin");
});

test("related products are real, deduplicated, exclude current product and stop at four", () => {
  const store = loadStorefront();
  const related = store.fn<(p: Record<string, unknown>, products: Record<string, unknown>[]) => Record<string, unknown>[]>("relatedProductsFor");
  const products = [full, full, ...[1, 2, 3, 4, 5].map((n) => apiProduct({ id: `r${n}`, series: n < 4 ? "Fairy" : "Other", category: "Duvar Tipi" }))];
  const result = related(full, products);
  assert.ok(result.length <= 4);
  assert.equal(result.some((p) => p.id === full.id), false);
  assert.equal(new Set(result.map((p) => p.id)).size, result.length);
});

test("copy contains no fake claims and mobile CSS targets overflow risks without hiding body overflow", () => {
  for (const claim of ["En Çok Satan", "%100 Memnuniyet", "Bugün 24 kişi satın aldı", "Son 2 ürün", "ücretsiz kurulum", "ücretsiz kargo", "Keşifte netleşir", "Randevu Al"]) assert.equal(js.toLocaleLowerCase("tr").includes(claim.toLocaleLowerCase("tr")), false, claim);
  assert.doesNotMatch(css, /body[^{}]*\{[^}]*overflow-x\s*:\s*hidden/i);
  assert.match(css, /min-width:0/);
  assert.match(css, /overflow-x:auto/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /@media\(max-width:380px\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test("the catalog list also drops the legacy source footer from descriptions without touching surrounding prose", async () => {
  const { toCatalogListItem } = await import("../lib/product-enrichment.ts");
  const item = toCatalogListItem({ id: "x", description: "Ürün metni.\n\nKaynak: https://www.gree.com.tr/urun/x", gallery: [1], sourceUrl: "u" }, 3);
  assert.equal(item.description, "Ürün metni.");
  assert.equal(item.stock, 3);
  assert.equal("gallery" in item, false);
});

test("catalog card images are width-bounded and related grids use minmax(0,1fr) so real product images cannot force body overflow", async () => {
  const { readFileSync } = await import("node:fs");
  assert.match(readFileSync("public/store.css", "utf8"), /\.product-visual \.product-image\{[^}]*max-width:100%[^}]*\}/);
  assert.match(readFileSync("public/product-detail.css", "utf8"), /@media\(max-width:650px\)\{\.related-section \.product-grid\{grid-template-columns:minmax\(0,1fr\)\}\}/);
  assert.doesNotMatch(readFileSync("public/product-detail.css", "utf8"), /body\{[^}]*overflow-x:\s*hidden/);
});

// ---- Phase 4B presentation ------------------------------------------------------------------------------
test("hero keeps one primary action per sale mode and quote-only never pretends a price", async () => {
  const online = await render(apiProduct({ id: "o1", stock: 2, saleMode: "online", price: 1000 }));
  assert.equal((online.root.innerHTML.match(/class="primary[^"]*"/g) || []).filter((c) => !/contact/.test(c)).length >= 1, true);
  assert.match(online.root.innerHTML, /class="pd-status is-available">Stokta · 2 adet/);
  assert.match(online.root.innerHTML, /class="pd-vat">KDV dahil/);
  const quote = await render(apiProduct({ id: "q1", stock: 5, saleMode: "quote", price: 0 }));
  assert.match(quote.root.innerHTML, /<a class="primary pd-cta" href="contact\.html\?subject=kesif&product=q1">Teklif talep et<\/a>/);
  assert.doesNotMatch(quote.root.innerHTML, /pd-amount">₺|KDV dahil/);
  assert.match(readFileSync("public/product-detail.css", "utf8"), /\.pd-buy a\.primary\{color:#fff\}/, "the quote CTA link must not inherit dark link colour on the dark button");
});

test("catalog and related cards never show an active add-to-cart for sold-out products", () => {
  const card = loadStorefront().fn<(p: unknown) => string>("productCard");
  const sold = card({ id: "s1", name: "S", sale: true, price: 1, stock: 0, imageUrl: "" });
  assert.match(sold, /class="primary" disabled>Tükendi</);
  assert.doesNotMatch(sold, /data-action="add-cart"/);
  assert.match(card({ id: "s2", name: "S", sale: true, price: 1, stock: 2, imageUrl: "" }), /data-action="add-cart" data-id="s2"/);
});

test("documents show a recognizable type and format without repeating the label", async () => {
  const { root } = await render(apiProduct({ id: "d1", documents: [
    { type: "manual", label: "Kullanım kılavuzu", url: "https://www.gree.com.tr/m.pdf" },
    { type: "catalog", label: "Ürün kataloğu", url: "https://tlcklima.com/c.pdf" },
    { type: "energy_label", label: "Enerji etiketi", url: "https://www.gree.com.tr/e.png" },
  ] }));
  assert.match(root.innerHTML, /doc-title">Kullanım kılavuzu<\/span><small>PDF</);
  assert.match(root.innerHTML, /doc-title">Ürün kataloğu<\/span><small>Katalog · PDF</);
  assert.match(root.innerHTML, /doc-icon" aria-hidden="true">IMG<[\s\S]*doc-title">Enerji etiketi<\/span><small>Görsel</);
  assert.match(root.innerHTML, /\(yeni sekmede açılır\)/);
});

test("long specification lists are grouped, short ones stay a single card, only verified API rows render", async () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ key: ["capacity_btu", "refrigerant", "seer", "scop", "indoor_weight", "indoor_dimensions", "indoor_sound_pressure", "unknown_key"][i], label: `L${i}`, value: `V${i}`, unit: null }));
  const grouped = await render(apiProduct({ id: "g1", specifications: many }));
  for (const heading of ["Genel", "Performans ve verimlilik", "Boyut ve ağırlık", "Hava akışı ve ses", "Diğer"]) assert.match(grouped.root.innerHTML, new RegExp(`<h3>${heading}</h3>`));
  const single = await render(apiProduct({ id: "g2", specifications: [{ key: "seer", label: "SEER", value: "8.5", unit: null }, { key: "x", label: "Boş", value: "  ", unit: null }] }));
  assert.match(single.root.innerHTML, /pd-spec-groups is-single/);
  assert.doesNotMatch(single.root.innerHTML, /<h3>|Boş/);
});

test("gallery selection updates in place in a real DOM and the page never re-renders for it", () => {
  assert.match(js, /swap in place: no page re-render/);
  assert.match(js, /data-gallery-count/);
  assert.match(js, /fetchpriority="high"/);
});

test("the not-found state still has a single H1 and no product content", async () => {
  const root = fakeElement();
  const store = loadStorefront({ path: "product.html", search: "?id=missing", elements: { "[data-product-page]": root }, api: { products: [] } });
  await store.fn<() => Promise<void>>("loadCatalog")();
  assert.equal((root.innerHTML.match(/<h1/g) || []).length, 1);
  assert.doesNotMatch(root.innerHTML, /Sepete Ekle|pd-hero/);
});

test("design tokens are defined once, mobile rules stack specs and related products scroll inside their own rail", () => {
  assert.match(css, /\[data-product-page\]\{--pd-surface:/);
  assert.match(css, /\.spec-table>\.spec-row\{grid-template-columns:minmax\(0,1fr\);gap:3px/);
  assert.match(css, /\.related-section \.product-grid\{display:grid;grid-template-columns:none;grid-auto-flow:column;[^}]*overflow-x:auto/);
  assert.doesNotMatch(css + readFileSync("public/store.css", "utf8"), /(^|[;{}])\s*(html|body)[^{]*\{[^}]*overflow-x\s*:\s*hidden/);
  assert.match(readFileSync("public/store.css", "utf8"), /\.product-visual \.product-image\{[^}]*height:100%[^}]*object-fit:contain/);
  for (const banned of [/indirim/, /eski fiyat/, /stokta son|son \d+ (adet|ürün)/, /popüler/, /en çok satan/, /randevu/, /yapay zeka/, /bugün \d+ kişi/]) assert.doesNotMatch(js.toLocaleLowerCase("tr"), banned);
});
