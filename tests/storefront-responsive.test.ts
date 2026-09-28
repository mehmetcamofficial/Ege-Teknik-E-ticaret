import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { apiProduct, fakeElement, loadStorefront, shippedStorefrontSources, storefrontCoreSource } from "./support/storefront-sandbox.ts";

const storeCss = readFileSync("public/store.css", "utf8");
const home = readFileSync("public/index.html", "utf8");
const js = storefrontCoreSource();
const shipped = shippedStorefrontSources().map(([, s]) => s).join("\n");
const customerPages = ["index", "catalog", "product", "favorites", "compare", "checkout", "second-hand", "policies", "contact", "services", "blog", "article", "regions", "region", "selector"].map((p) => [p, readFileSync(`public/${p}.html`, "utf8")] as const);

test("store header: menu button precedes the panel it controls, reports state and labels icon links", () => {
  const root = fakeElement();
  loadStorefront({ elements: { "[data-site-header]": root } }).fn<() => void>("renderHeader")();
  const html = root.innerHTML;
  // The menu button comes before the drawer it controls, names it and reports its state; the drawer is the primary navigation landmark.
  assert.match(html, /<button type="button" class="menu-toggle ghost" data-action="toggle-menu" aria-expanded="false" aria-controls="site-nav" aria-label="Menüyü aç">/);
  assert.ok(html.indexOf('aria-controls="site-nav"') < html.indexOf('<nav class="nav-bar" id="site-nav" aria-label="Ana menü">'));
  // Icon-only links carry an accessible name; the visual is an inline SVG, not a glyph.
  assert.match(html, /class="header-icon[^"]*" href="favorites\.html" title="Favoriler" aria-label="Favoriler"><svg/);
  assert.match(html, /class="header-icon[^"]*" href="compare\.html" title="Karşılaştır" aria-label="Karşılaştır"><svg/);
  assert.match(html, /class="nav-extra" href="favorites\.html"/, "favourites stay reachable from the menu when the icons are hidden on narrow screens");
  assert.match(html, /<form class="header-search" action="catalog\.html" method="get" role="search"><label class="sr-only" for="site-search">/, "the header search is a labelled GET form to the catalog");
  assert.match(js, /if\(e\.key==='Escape'\)\{const open=document\.querySelector\('\.store-nav>\[data-action="toggle-menu"\]\[aria-expanded="true"\]'\);if\(open\)\{setMenu\(open,false\);open\.focus\(\)/);
});

test("header never wraps into two rows or hides the menu behind nowrap overflow", () => {
  // Below 1024px the navigation moves into an off-canvas drawer opened by the menu button; nothing is clipped by nowrap overflow.
  assert.match(storeCss, /\.store-nav>\.menu-toggle\{order:0;display:none\}/);
  assert.match(storeCss, /@media\(max-width:1023px\)\{[^@]*\.store-nav>\.menu-toggle\{display:inline-flex;order:0\}/);
  assert.match(storeCss, /\.nav-bar\.open\{transform:none;visibility:visible/);
  assert.match(storeCss, /\.store-nav \.header-tools>a\.header-icon\{display:inline-grid;place-items:center;width:44px;height:44px/);
});

test("grid tracks shrink below their content so long selects/names cannot push the page wider", () => {
  assert.match(storeCss, /\.checkout-grid\{grid-template-columns:minmax\(0,1\.25fr\) minmax\(0,\.75fr\)\}/);
  assert.match(storeCss, /\.field-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}@media\(max-width:650px\)\{\.field-grid\{grid-template-columns:minmax\(0,1fr\)\}\}/);
  assert.match(storeCss, /\.store input,\.store select,\.store textarea\{max-width:100%;min-width:0\}/);
  for (const [name, css] of [["store.css", storeCss], ["product-detail.css", readFileSync("public/product-detail.css", "utf8")]] as const) assert.doesNotMatch(css, /(^|[;{}])\s*(html|body)[^{]*\{[^}]*overflow-x\s*:\s*(hidden|clip)/, name);
});

test("touch targets: chips, card tools, card actions and filter rows reach 44px on touch widths", () => {
  assert.match(storeCss, /@media\(max-width:1000px\)\{\.chip\{min-height:44px\}\.store \.card-tools button\{min-height:44px;min-width:44px\}\.filter-group label\{min-height:44px;margin:0\}\}/);
  assert.match(storeCss, /\.product \.actions>\*\{min-height:44px/);
  assert.match(storeCss, /\.store input\[type=radio\],\.store input\[type=checkbox\]\{width:20px;height:20px/);
});

test("compare is a labelled, focusable scroll region with a hint and shows sale state honestly", async () => {
  const root = fakeElement();
  const products = [apiProduct({ id: "a", name: "A", stock: 2 }), apiProduct({ id: "b", name: "B", stock: 0 }), apiProduct({ id: "c", name: "C", saleMode: "quote" })];
  const store = loadStorefront({ path: "compare.html", elements: { "[data-compare]": root }, storage: { "ege-compare": ["a", "b", "c"] }, api: { products } });
  await store.fn<() => Promise<void>>("loadCatalog")();
  assert.match(root.innerHTML, /<p class="compare-hint" id="compare-hint">/);
  assert.match(root.innerHTML, /class="compare-scroll" role="region" aria-label="Ürün karşılaştırma tablosu" aria-describedby="compare-hint" tabindex="0"/);
  assert.match(root.innerHTML, /style="--cmp-n:3"/);
  assert.match(root.innerHTML, /Stokta[\s\S]*Tükendi[\s\S]*Teklif ile satılır/);
  assert.doesNotMatch(storeCss, /repeat\(calc\(/, "calc() inside repeat() invalidates the whole grid template");
});

test("empty states offer a real next action", async () => {
  for (const [path, sel, key] of [["favorites.html", "[data-favorites]", "ege-favorites"], ["compare.html", "[data-compare]", "ege-compare"]] as const) {
    const root = fakeElement();
    const store = loadStorefront({ path, elements: { [sel]: root }, storage: { [key]: [] }, api: { products: [apiProduct({ id: "x" })] } });
    await store.fn<() => Promise<void>>("loadCatalog")();
    assert.match(root.innerHTML, /<a class="primary inline" href="catalog\.html">/, path);
  }
  assert.match(storeCss, /\.store a\.primary\{color:#fff\}/, "button-styled links must not inherit dark link colour");
});

test("contact form failures are announced inline, never through alert()", () => {
  assert.doesNotMatch(shipped, /\balert\(/);
  assert.match(js, /status\.setAttribute\('role','alert'\)/);
});

test("customer-facing identity: only the verified e-mail, no stale addresses or domains", () => {
  const all = customerPages.map(([, html]) => html).join("\n") + shipped;
  assert.doesNotMatch(all, /oncoconnect2@gmail\.com|trendklima/i);
  assert.match(js, /email:'info@egeteknik\.tr'/);
  assert.match(home, /href="mailto:info@egeteknik\.tr"/);
  for (const phone of all.match(/wa\.me\/\d+/g) ?? []) assert.equal(phone, "wa.me/905427957560");
});

test("homepage: shared header with mobile menu, no fake live indicators, accessible WhatsApp green, alt text", () => {
  // The homepage uses the same header as every store page (renderHeader), including the mobile drawer.
  assert.match(home, /<div data-site-header><\/div>/);
  assert.match(js, /data-action="toggle-menu" aria-expanded="false" aria-controls="site-nav"/);
  assert.doesNotMatch(home, /animate-(ping|pulse|bounce)/);
  assert.doesNotMatch(home, /Mühendise Danış|Mühendisimizle|WhatsApp Canlı Danışman/);
  assert.match(storeCss, /--wa:#0f7a42/, "WhatsApp actions use the accessible dark green, not the brand #25D366");
  assert.equal((home.match(/<img\b(?![^>]*\salt=)/g) ?? []).length, 0);
  assert.equal((home.match(/aria-label="Sepeti Aç"/g) ?? []).length, 0, "the duplicate floating cart is gone; the header cart remains");
});

test("customer pages have no dead links or javascript: actions", () => {
  for (const [name, html] of customerPages) {
    assert.doesNotMatch(html, /href="#"|href="javascript:/i, name);
    assert.doesNotMatch(html, /<a\b(?![^>]*\bhref=)[^>]*>/, name);
  }
});

test("second-hand request links stay readable on the dark cards", () => {
  assert.match(storeCss, /\.second-card \.ghost\{color:var\(--p\)/);
  assert.match(readFileSync("public/catalog.html", "utf8"), /<label class="sr-only" for="catalog-search">Katalogda ara<\/label>/);
});

// ---- Phase 4C finalization ------------------------------------------------------------------------------
test("checkout has the delivery model in the markup: province and district selects, no retired installation control, no free-shipping wording", () => {
  const html = readFileSync("public/checkout.html", "utf8");
  assert.match(html, /<select name="city" data-province autocomplete="address-level1">/, "the province is a controlled select filled from the API list");
  assert.match(html, /<select name="district" data-district autocomplete="address-level2" disabled><option value="">Önce il seçin<\/option><\/select>/, "the district is a select, disabled until a province is chosen");
  assert.doesNotMatch(html, /<input[^>]*name="district"/, "no free-text district input");
  assert.match(html, /data-delivery-options/);
  assert.doesNotMatch(html, /name="installation"|data-installation|survey_then_install|delivery_only|Kurulum istiyorum|Kurulum \(isteğe bağlı\)/, "the optional-installation control is gone");
  assert.doesNotMatch(html, /İl \/ İlçe/, "the single free-text city field is gone");
  assert.doesNotMatch(html, /<select[^>]*title=/);
  assert.doesNotMatch(html, /[Üü]cretsiz (kargo|montaj)|[Bb]edava/);
});
test("checkout delivery UI is responsive with 44px targets: option rows, single-column grid on narrow screens, 16px form controls", () => {
  assert.match(storeCss, /\.delivery-option\{[^}]*min-height:44px/);
  assert.match(storeCss, /@media\(max-width:1000px\)\{\.shop-grid,\.checkout-grid\{grid-template-columns:minmax\(0,1fr\)\}\}/);
  assert.match(storeCss, /@media\(max-width:650px\)\{\.field-grid\{grid-template-columns:minmax\(0,1fr\)\}\}/);
  assert.match(storeCss, /@media\(max-width:650px\)\{\.field input,\.field select,\.field textarea\{font-size:16px;min-height:46px\}\}/);
  assert.match(storeCss, /\.delivery-option small\{[^}]*overflow-wrap:anywhere/);
});

test("homepage readable text: no 10-11px label tokens, 12px+ top bar and tagline", () => {
  assert.match(storeCss, /\.store-top\{background:var\(--p\);color:#d8ebe4;font-size:13px\}/);
  assert.match(storeCss, /\.brand small\{font-size:12px/);
  assert.doesNotMatch(storeCss, /font-size:1[01](\.\d+)?px/, "no 10-11px text anywhere in the shared stylesheet");
});

test("homepage product imagery is real, local and optimized: no representative illustrations or remote mock-up images", () => {
  assert.doesNotMatch(home, /googleusercontent|temsili|Temsili/);
  const imgs = home.match(/<img\b[^>]*>/g) ?? [];
  assert.ok(imgs.length >= 5);
  for (const img of imgs) {
    assert.match(img, /src="\/assets\/home\/[a-z-]+-\d+\.webp"/, img);
    assert.match(img, /\swidth="\d+" height="\d+"/, `${img} reserves its box (CLS)`);
  }
  // Only the hero image is eager; everything below the fold is lazy.
  assert.equal(imgs.filter((img) => /fetchpriority="high"/.test(img)).length, 1);
  assert.equal(imgs.filter((img) => !/fetchpriority="high"/.test(img) && !/loading="lazy"/.test(img)).length, 0);
});

test("header search is shown on desktop and moves into the menu drawer on narrow screens", () => {
  assert.match(storeCss, /@media\(max-width:1023px\)\{[^@]*\.header-search\{display:none\}/);
  assert.match(js, /<form class="drawer-search" action="catalog\.html" method="get" role="search">/);
});
