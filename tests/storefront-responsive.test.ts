import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { apiProduct, fakeElement, loadStorefront } from "./support/storefront-sandbox.ts";

const storeCss = readFileSync("public/store.css", "utf8");
const home = readFileSync("public/index.html", "utf8");
const js = readFileSync("public/store.js", "utf8");
const customerPages = ["index", "catalog", "product", "favorites", "compare", "checkout", "second-hand", "policies", "contact", "services", "blog", "article", "regions", "region", "selector"].map((p) => [p, readFileSync(`public/${p}.html`, "utf8")] as const);

test("store header: menu button precedes the panel it controls, reports state and labels icon links", () => {
  const root = fakeElement();
  loadStorefront({ elements: { "[data-site-header]": root } }).fn<() => void>("renderHeader")();
  const html = root.innerHTML;
  assert.match(html, /<button type="button" class="menu-toggle ghost" data-action="toggle-menu" aria-expanded="false" aria-controls="site-nav">Menü<\/button><div class="nav-links" id="site-nav">/);
  assert.match(html, /aria-label="Favoriler">♡/);
  assert.match(html, /aria-label="Karşılaştır">⇄/);
  assert.match(html, /class="nav-extra" href="favorites\.html"/, "favourites stay reachable from the menu when the icons are hidden on narrow screens");
  assert.match(js, /if\(e\.key==='Escape'\)\{const open=document\.querySelector\('\[data-action="toggle-menu"\]\[aria-expanded="true"\]'\);if\(open\)\{setMenu\(open,false\);open\.focus\(\)/);
});

test("header never wraps into two rows or hides the menu behind nowrap overflow", () => {
  assert.match(storeCss, /@media\(max-width:1180px\)\{\.store-nav\{flex-wrap:wrap;row-gap:0\}/);
  assert.match(storeCss, /\.store-nav>\.menu-toggle\{order:3;display:none\}/);
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
  assert.doesNotMatch(js, /\balert\(/);
  assert.match(js, /status\.setAttribute\('role','alert'\)/);
});

test("customer-facing identity: only the verified e-mail, no stale addresses or domains", () => {
  const all = customerPages.map(([, html]) => html).join("\n") + js;
  assert.doesNotMatch(all, /oncoconnect2@gmail\.com|trendklima/i);
  assert.match(js, /email:'info@egeteknik\.tr'/);
  assert.match(home, /href="mailto:info@egeteknik\.tr"/);
  for (const phone of all.match(/wa\.me\/\d+/g) ?? []) assert.equal(phone, "wa.me/905427957560");
});

test("homepage: mobile menu exists, no fake live indicators, accessible WhatsApp green, labelled calculator, alt text", () => {
  assert.match(home, /data-action="toggle-menu" aria-expanded="false" aria-controls="home-mobile-nav"/);
  assert.match(home, /<nav id="home-mobile-nav"/);
  assert.doesNotMatch(home, /animate-(ping|pulse|bounce)/);
  assert.doesNotMatch(home, /Mühendise Danış|Mühendisimizle|WhatsApp Canlı Danışman/);
  assert.match(home, /"whatsapp-green": "#0F7A42"/);
  for (const id of ["area-slider", "room-type", "sun-exposure", "insulation"]) assert.match(home, new RegExp(`id="${id}" aria-label="`));
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

test("homepage readable text: no 10-11px shared label token, 12px+ top bar and tagline", () => {
  assert.match(home, /"label-sm": \["12px"/);
  assert.match(home, /h-9 flex items-center justify-between font-label-sm text-\[12px\] sm:text-\[13px\]/);
  assert.match(home, /text-\[12px\] font-semibold tracking-\[0\.08em\] text-secondary whitespace-nowrap">KLİMA &amp; TEKNOLOJİ/);
  assert.match(storeCss, /\.brand small\{font-size:12px/);
});

test("area slider: slim visual track, 44px interactive height, keyboard-operable native range", () => {
  assert.match(home, /<input class="w-full appearance-none cursor-pointer accent-secondary" id="area-slider" aria-label="Alan \(m²\)"[^>]*type="range"/);
  assert.match(home, /#area-slider\{height:44px;background:transparent/);
  assert.match(home, /#area-slider::-webkit-slider-runnable-track\{height:10px/);
});

test("illustrative homepage images are visibly and textually labelled, never presented as model photos", () => {
  const imgs = home.match(/<img\b[^>]*googleusercontent[^>]*>/g) ?? [];
  assert.equal(imgs.length, 7);
  for (const img of imgs) assert.match(img, /alt="[^"]*\(temsili görsel\)"/);
  assert.equal((home.match(/>Temsili görsel<\/span>/g) ?? []).length, 7);
});

test("homepage header search appears only where the header has room for it", () => {
  assert.match(home, /class="relative hidden lg:block xl:hidden w-56"/);
});
