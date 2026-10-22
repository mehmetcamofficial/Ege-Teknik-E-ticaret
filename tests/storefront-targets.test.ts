import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { storefrontCoreSource } from "./support/storefront-sandbox.ts";

/**
 * Phase 3.5: the storefront navigation/action controls keep a 44px touch target on every viewport.
 * The rendered heights were measured in a real browser; this only guards the CSS contract that produces them.
 * The effective declaration is the LAST rule that names the selector (the Phase 3.5 block sits at the end).
 */
const css = readFileSync(new URL("../public/store.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => ({ selectors: m[1].split(",").map((x) => x.trim()), body: m[2] }));
const minHeight = (selector: string) => {
  const hit = rules.filter((r) => r.selectors.includes(selector) && /min-height:\s*(\d+)px/.test(r.body)).at(-1);
  return hit ? Number(/min-height:\s*(\d+)px/.exec(hit.body)![1]) : 0;
};

test("header, breadcrumb, footer, card-title and consent controls are 44px on all viewports", () => {
  for (const selector of [".store-nav .brand", ".store-footer .brand", ".store-nav .nav-links a", ".breadcrumbs a", ".store-footer a:not(.brand)", ".store-shell h3>a", ".chip", ".filter-group label", ".consent", "button.primary", ".store .card-tools button"]) {
    assert.ok(minHeight(selector) >= 44, `${selector} min-height is ${minHeight(selector)}px`);
  }
});

test("the compact top-bar phone link gets a 44px hit area without growing the sticky header", () => {
  assert.match(css, /\.store-top a::after\{content:"";position:absolute;inset:-10px -8px\}/);
});

test("the mobile menu button, cart link, icon links and the checkout back link stay 44px, and icon-only links have accessible names", () => {
  assert.ok(minHeight(".store-nav>.menu-toggle") >= 44 || /menu-toggle\{display:inline-flex;align-items:center;min-height:44px/.test(css));
  assert.ok(minHeight(".store-nav .header-tools .header-cart") >= 44);
  assert.match(css, /\.header-icon\{display:inline-grid;place-items:center;width:44px;height:44px/);
  const js = storefrontCoreSource();
  for (const label of ["Favoriler", "Karşılaştır"]) assert.match(js, new RegExp(`class="header-icon[^"]*"[^>]*aria-label="${label}"`));
  // the checkout header's "Mağazaya dön" is a .nav-links link, which the 44px rule above covers
  assert.match(readFileSync(new URL("../public/checkout.html", import.meta.url), "utf8"), /<div class="nav-links"><a href="catalog.html">Mağazaya dön<\/a><\/div>/);
});

test("product detail trust links (garanti, satış/iade) are 44px targets", () => {
  const pd = readFileSync(new URL("../public/product-detail.css", import.meta.url), "utf8");
  assert.match(pd, /\.pd-trust a\{display:inline-flex;align-items:center;min-height:44px;/);
});
