/**
 * Phase 3A.3F storefront integrity: one price source, safe navigation, escaped output.
 * Every behavioural test runs the real public/store.js (tests/support/storefront-sandbox.ts)
 * with synthetic catalog data - never today's real prices, which the admin can change.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LIVE_HANDLER_ATTR, ORIGIN, apiProduct, confirmationBox, fakeElement, featuredCard, loadStorefront } from "./support/storefront-sandbox.ts";

const homepage = readFileSync("public/index.html", "utf8");
const storeJs = readFileSync("public/store.js", "utf8");
const withoutScripts = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "");
const TRY_AMOUNT = /\d{1,3}(?:\.\d{3})+\s*₺|₺\s*\d/;
const money = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);

// ---------------------------------------------------------------------------
// Price authority
// ---------------------------------------------------------------------------

test("the homepage ships no price figure - every ₺ amount it shows comes from the catalog at runtime", () => {
  const match = withoutScripts(homepage).match(TRY_AMOUNT);
  assert.equal(match, null, `hard-coded price in public/index.html: ${match?.[0]}`);
});

test("store.js carries no bundled product/price list that could drift from the served catalog", () => {
  assert.doesNotMatch(storeJs, /\bprice\s*:\s*\d/, "a numeric price literal in store.js is a second price source");
  assert.doesNotMatch(storeJs, /\bconst\s+seed\b/);
});

test("every homepage product reference (featured card, product link, favorite button) names one of the featured catalog products", () => {
  const featuredIds = new Set([...homepage.matchAll(/data-featured-product="([^"]+)"/g)].map((m) => m[1]));
  assert.ok(featuredIds.size >= 3, "expected the hero + three featured cards to be catalog-bound");
  const linked = [...homepage.matchAll(/href="product\.html\?id=([^"]+)"/g)].map((m) => decodeURIComponent(m[1]));
  const favorites = [...homepage.matchAll(/data-favorite-id="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(linked.length > 0 && favorites.length > 0);
  for (const id of [...linked, ...favorites]) assert.ok(featuredIds.has(id), `homepage references ${id}, which no featured card renders from the catalog`);
});

test("the same product shows the same catalog price on the homepage, the catalog, the product page and in the cart", async () => {
  const product = apiProduct({ id: "synthetic-airy", price: 71_234, stock: 4 });
  const card = featuredCard("synthetic-airy");
  const elements = { "[data-products]": fakeElement(), "[data-product-page]": fakeElement(), "[data-cart-items]": fakeElement() };
  const store = loadStorefront({ search: "?id=synthetic-airy", featured: [card], elements, storage: { "ege-cart": [{ productId: "synthetic-airy", quantity: 1 }] }, api: { products: [product] } });
  await store.fn<() => Promise<void>>("loadCatalog")();

  const shown = card.fields.price.textContent;
  assert.equal(shown, money(71_234), "homepage card must show the served catalog price");
  assert.equal(card.fields.name.textContent, product.name);
  assert.equal(card.fields.stock.textContent, "Stok: 4");
  // The spec tiles are catalog-bound too: no hard-coded performance figures on the homepage.
  assert.equal(card.fields.capacity.textContent, product.capacity);
  assert.equal(card.fields.sku.textContent, product.sku);
  for (const [surface, el] of Object.entries(elements)) assert.ok(el.innerHTML.includes(shown), `${surface} shows a different price than the homepage`);
});

test("before the catalog answers, no surface shows a price - only a loading state", () => {
  const card = featuredCard("synthetic-airy");
  const elements = { "[data-products]": fakeElement(), "[data-product-page]": fakeElement(), "[data-cart-items]": fakeElement() };
  const store = loadStorefront({ search: "?id=synthetic-airy", featured: [card], elements, storage: { "ege-cart": [{ productId: "synthetic-airy", quantity: 1 }] }, api: { products: "pending" } });
  for (const render of ["renderFeaturedProducts", "renderCatalog", "renderProductPage", "renderCheckout"]) store.fn<() => void>(render)();
  assert.equal(card.fields.price.textContent, "Fiyat yükleniyor…");
  for (const el of Object.values(elements)) {
    assert.match(el.innerHTML, /yükleniyor/);
    assert.doesNotMatch(el.innerHTML, TRY_AMOUNT);
  }
  assert.equal(store.fn<() => boolean>("catalogAuthoritative")(), false);
});

test("when the catalog is unavailable every surface says so and none invents a price", async () => {
  const card = featuredCard("synthetic-airy");
  const elements = { "[data-products]": fakeElement(), "[data-product-page]": fakeElement(), "[data-favorites]": fakeElement(), "[data-compare]": fakeElement(), "[data-cart-items]": fakeElement() };
  const store = loadStorefront({ search: "?id=synthetic-airy", featured: [card], elements, storage: { "ege-cart": [{ productId: "synthetic-airy", quantity: 1 }] }, api: { products: "fail", detail: "fail" } });
  await store.fn<() => Promise<void>>("loadCatalog")();
  assert.equal(store.fn<() => boolean>("catalogAuthoritative")(), false);
  assert.equal(card.fields.price.textContent, "Fiyat bilgisi alınamadı");
  for (const [surface, el] of Object.entries(elements)) {
    assert.match(el.innerHTML, /şu anda alınamıyor/, `${surface} should state the catalog is unavailable`);
    assert.doesNotMatch(el.innerHTML, TRY_AMOUNT, `${surface} must not show a price without the catalog`);
  }
});

test("a featured product missing from the catalog is shown as not listed, never with a remembered price", async () => {
  const card = featuredCard("no-longer-sold");
  const store = loadStorefront({ featured: [card], api: { products: [apiProduct()] } });
  await store.fn<() => Promise<void>>("loadCatalog")();
  assert.equal(card.fields.price.textContent, "Şu anda listelenmiyor");
});

test("an unknown product id says the product was not found instead of showing a different product", async () => {
  const page = fakeElement();
  const store = loadStorefront({ search: "?id=does-not-exist", elements: { "[data-product-page]": page }, api: { products: [apiProduct({ name: "Başka Ürün" })] } });
  await store.fn<() => Promise<void>>("loadCatalog")();
  assert.match(page.innerHTML, /Ürün bulunamadı/);
  assert.doesNotMatch(page.innerHTML, /Başka Ürün/);
});

test("the capacity chips match real catalog capacities written as '12000 BTU/h'", async () => {
  const grid = fakeElement();
  const chip = { dataset: { btu: "12.000" } };
  const store = loadStorefront({ elements: { "[data-products]": grid, ".chip.active": chip as never }, api: { products: [apiProduct({ id: "a", name: "On İki", capacity: "12000 BTU/h" }), apiProduct({ id: "b", name: "Dokuz", capacity: "9000 BTU/h" })] } });
  await store.fn<() => Promise<void>>("loadCatalog")();
  assert.match(grid.innerHTML, /On İki/);
  assert.doesNotMatch(grid.innerHTML, /Dokuz/);
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function clickNavigate(href: string) {
  const store = loadStorefront({ path: "second-hand.html" });
  const before = store.location.href;
  store.fn<(e: unknown) => void>("handleDelegatedClick")({ target: { closest: () => ({ dataset: { action: "navigate", href } }) } });
  return { navigatedTo: store.location.href === before ? null : store.location.href };
}

test("navigate rejects every non-site destination a data-href could carry", () => {
  for (const hostile of [
    "javascript:alert(1)",
    " JaVaScRiPt:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "//evil.example/phish",
    "/\\evil.example/phish",
    "\\\\evil.example\\phish",
    "https://evil.example/phish",
    "http://shop.test.evil.example/",
    "ftp://shop.test/file",
  ]) {
    assert.equal(clickNavigate(hostile).navigatedTo, null, `navigated to hostile destination: ${JSON.stringify(hostile)}`);
  }
});

test("navigate still follows legitimate internal destinations", () => {
  assert.equal(clickNavigate("contact.html?subject=ikinci-el&product=x").navigatedTo, "/contact.html?subject=ikinci-el&product=x");
  assert.equal(clickNavigate("/catalog.html?category=Duvar%20Tipi").navigatedTo, "/catalog.html?category=Duvar%20Tipi");
  assert.equal(clickNavigate(`${ORIGIN}/policies.html#privacy`).navigatedTo, "/policies.html#privacy");
});

// ---------------------------------------------------------------------------
// Output escaping (admin/API data is plain text; nothing here is rich HTML)
// ---------------------------------------------------------------------------

const PAYLOAD = `"><img src=x onerror=alert(1)><script>alert(2)</script>'`;

function assertInert(html: string, where: string) {
  assert.doesNotMatch(html, /<script/i, `${where}: live <script>`);
  assert.doesNotMatch(html, /<img src=x/i, `${where}: injected <img>`);
  // Payload text inside a properly quoted attribute value (its own quote escaped to &quot;)
  // is inert, so blank out quoted values first: a handler that survives that has broken
  // out of its attribute and would be a real, parsed attribute.
  const outsideQuotedValues = html.replace(/"[^"]*"/g, '""');
  assert.equal(outsideQuotedValues.match(LIVE_HANDLER_ATTR), null, `${where}: live event-handler attribute`);
}

test("product data from the API is escaped on every product surface", async () => {
  const hostile = apiProduct({ id: `id${PAYLOAD}`, name: PAYLOAD, category: PAYLOAD, series: PAYLOAD, capacity: `${PAYLOAD} BTU`, energyClass: PAYLOAD, wifi: PAYLOAD, sku: PAYLOAD, imageUrl: `https://img.test/a.jpg${PAYLOAD}` });
  const elements = { "[data-products]": fakeElement(), "[data-product-page]": fakeElement(), "[data-favorites]": fakeElement(), "[data-compare]": fakeElement(), "[data-cart-items]": fakeElement() };
  const store = loadStorefront({
    search: `?id=${encodeURIComponent(hostile.id)}`,
    elements,
    storage: { "ege-favorites": [hostile.id], "ege-compare": [hostile.id] },
    api: { products: [hostile] },
  });
  await store.fn<() => Promise<void>>("loadCatalog")();
  for (const [surface, el] of Object.entries(elements)) if (surface !== "[data-cart-items]") {
    assert.ok(el.innerHTML.length > 0, `${surface} rendered nothing`);
    assertInert(el.innerHTML, surface);
    assert.ok(el.innerHTML.includes("&lt;script&gt;"), `${surface} should show the payload as text`);
  }
});

test("admin-authored blog posts render as escaped plain text, keeping only paragraph breaks", async () => {
  const list = fakeElement();
  const article = fakeElement();
  const post = { slug: "guvenli-yazi", title: PAYLOAD, excerpt: PAYLOAD, content: `İlk paragraf ${PAYLOAD}\nikinci satır\n\nİkinci paragraf`, imageUrl: "javascript:alert(3)" };
  const store = loadStorefront({ path: "article.html", search: "?slug=guvenli-yazi", elements: { "[data-blog]": list, "[data-article]": article }, api: { blog: [post], secondHand: [] } });
  await store.fn<() => Promise<void>>("loadManagedContent")();
  for (const [where, html] of [["blog list", list.innerHTML], ["article", article.innerHTML]] as const) {
    assertInert(html, where);
    assert.doesNotMatch(html, /javascript:/i, `${where}: javascript: image source kept`);
  }
  assert.match(article.innerHTML, /<p>İlk paragraf .*<br>ikinci satır<\/p><p>İkinci paragraf<\/p>/);
});

test("second-hand stock renders escaped on its page and on the homepage, with a quote-safe slug link", async () => {
  const page = fakeElement();
  const home = fakeElement();
  const item = { slug: `x${PAYLOAD}`, name: PAYLOAD, category: PAYLOAD, condition: PAYLOAD, description: PAYLOAD, testNotes: PAYLOAD, price: 5_000, stock: 1, imageUrl: `https://img.test/b.jpg"onerror="alert(4)` };
  const emptyNotice = fakeElement();
  const store = loadStorefront({ path: "second-hand.html", elements: { ".second-grid": page, "[data-home-second-hand]": home, "[data-second-hand-empty]": emptyNotice }, api: { blog: [], secondHand: [item] } });
  await store.fn<() => Promise<void>>("loadManagedContent")();
  assert.equal(emptyNotice.removed, true, "the 'no second-hand stock' notice must go once real stock is shown");
  assertInert(page.innerHTML, "second-hand page");
  assertInert(home.innerHTML, "homepage outlet");
  assert.match(home.innerHTML, /href="contact\.html\?subject=ikinci-el&amp;product=x%22%3E%3Cimg/);
});

test("the homepage outlet shows honest empty and unavailable states instead of sample products", async () => {
  const empty = fakeElement();
  await loadStorefront({ elements: { "[data-home-second-hand]": empty }, api: { blog: [], secondHand: [] } }).fn<() => Promise<void>>("loadManagedContent")();
  assert.match(empty.innerHTML, /yayında ikinci el ürün bulunmuyor/);
  const down = fakeElement();
  await loadStorefront({ elements: { "[data-home-second-hand]": down }, api: { blog: [], secondHand: "fail" } }).fn<() => Promise<void>>("loadManagedContent")();
  assert.match(down.innerHTML, /şu anda alınamıyor/);
});

test("a hostile ?city= value is never echoed into the region page", () => {
  const root = fakeElement();
  const store = loadStorefront({ path: "region.html", search: `?city=${encodeURIComponent(PAYLOAD)}`, elements: { "[data-region-page]": root } });
  store.fn<() => void>("renderRegionPage")();
  assertInert(root.innerHTML, "region page");
  assert.doesNotMatch(root.innerHTML, /onerror|alert/);
  assert.match(root.innerHTML, /Ege Bölgesi Klima Satış/);
});

test("a hostile order number in the server response is shown as text", async () => {
  const result = { textContent: "", innerHTML: "" };
  const button = { disabled: false, textContent: "" };
  const form = { ...fakeElement(), hidden: false, fields: { customerName: "Ada", phone: "05001112233", email: "a@b.test", city: "İzmir", address: "Sokak No 1", provider: "PayTR" }, querySelectorAll: (s: string) => (s === "[data-legal-version]" ? [{ checked: true, dataset: { legalVersion: "ver-ds-1" } }] : []), querySelector: (s: string) => (s === "button.primary" ? button : s === "[data-order-result]" ? result : null) };
  const box = confirmationBox();
  const store = loadStorefront({
    storage: { "ege-cart": [{ productId: "synthetic-product-1", quantity: 1 }] },
    elements: { "[data-order-confirmation]": box, "[data-checkout-form]": form },
    api: {
      products: [apiProduct()],
      order: async () => ({
        ok: true, status: 201, json: async () => ({
          ok: true, orderNumber: PAYLOAD, status: "pending_payment",
          items: [{ productName: "Sentetik Ürün 12000 BTU/h", quantity: 1, unitPrice: 12_345, lineTotal: 12_345 }],
          subtotal: 10_288, vatTotal: 2_057, shippingTotal: 0, installationTotal: 0, total: 12_345,
          delivery: { name: "Ada", phone: "05001112233", email: "a@b.test", city: "İzmir", address: "Sokak No 1", installation: "delivery_only" },
        }),
      }),
    },
  });
  await store.fn<() => Promise<void>>("loadCatalog")();
  await store.fn<() => Promise<unknown>>("loadLegalRequirements")();
  await store.fn<() => Promise<unknown>>("loadCheckoutCharges")();
  await store.fn<(e: unknown) => Promise<void>>("submitOrder")({ preventDefault: () => {}, currentTarget: form });
  const numberCell = box.children["[data-confirmation-number]"];
  assert.match(numberCell.innerHTML, /Takip numarası/);
  assertInert(numberCell.innerHTML, "order confirmation number");
  assert.equal(box.hidden, false, "the confirmation panel is shown");
  assert.equal(form.hidden, true, "the form is hidden once the order is confirmed");
});

test("homepage featured fields are written as text, so a hostile product name stays inert", async () => {
  const card = featuredCard("synthetic-airy");
  const store = loadStorefront({ featured: [card], api: { products: [apiProduct({ id: "synthetic-airy", name: PAYLOAD })] } });
  await store.fn<() => Promise<void>>("loadCatalog")();
  assert.equal(card.fields.name.textContent, PAYLOAD, "textContent keeps the payload as literal text");
  assert.equal(card.fields.name.innerHTML, "", "nothing was written as markup");
});
