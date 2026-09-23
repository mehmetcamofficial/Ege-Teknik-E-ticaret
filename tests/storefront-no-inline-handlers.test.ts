/**
 * Phase 3A.3E follow-up: the site's CSP (see lib/security-headers.ts) has no
 * 'unsafe-hashes', so an inline HTML event-handler attribute (onclick="...",
 * onchange="...", etc.) is silently non-functional in the real, deployed
 * app - confirmed live in a browser during this phase. This file guards
 * against that regressing, both statically (every public/*.html page) and
 * dynamically (the actual generated markup from public/store.js, executed
 * via node:vm - not re-implemented here - the same technique already used by
 * tests/storefront-product-image.test.ts).
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { apiProduct, fakeElement, loadStorefront } from "./support/storefront-sandbox.ts";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const pages = readdirSync(PUBLIC_DIR).filter((entry) => entry.endsWith(".html"));
const storeJsSource = readFileSync(path.join(PUBLIC_DIR, "store.js"), "utf8");

const INLINE_HANDLER_ATTR = /<[a-z][a-z0-9]*\b[^>]*\son[a-z]+="[^"]*"/i;

// --- Static: every shipped page ---------------------------------------------

test("no static storefront page contains an inline on*=\"...\" event-handler attribute", () => {
  for (const page of pages) {
    const html = readFileSync(path.join(PUBLIC_DIR, page), "utf8");
    const match = html.match(INLINE_HANDLER_ATTR);
    assert.equal(match, null, `${page} still has an inline event-handler attribute: ${match?.[0]}`);
  }
});

test("public/store.js contains no on*=\"...\" attribute in any generated-HTML template string", () => {
  // A JS-assigned `el.onclick = fn` property is fine (not CSP-restricted) and must not
  // false-positive here; neither should prose in a comment - only text shaped like an
  // actual HTML tag attribute (<tag ... on*="...) is checked, same as INLINE_HANDLER_ATTR.
  const match = storeJsSource.match(INLINE_HANDLER_ATTR);
  assert.equal(match, null, `store.js still emits an inline event-handler attribute into generated HTML: ${match?.[0]}`);
});

test("store.js defines exactly one delegated click listener wired to a named, testable handler", () => {
  assert.match(storeJsSource, /function handleDelegatedClick\(/);
  assert.match(storeJsSource, /document\.addEventListener\('click',\s*handleDelegatedClick\)/);
});

// --- Dynamic: exercise the real generated markup via the real file ---------

const SALE_PRODUCT = { id: "p1", name: "Test Ürün", category: "Duvar Tipi", series: "Aphro", capacity: "9.000 BTU", energy: "A++", wifi: "Dahili", sale: true, price: 1000, stock: 1, imageUrl: "" };
const QUOTE_PRODUCT = { ...SALE_PRODUCT, id: "p2", sale: false };
const API_SALE_PRODUCT = apiProduct({ id: "p1", name: "Test Ürün", stock: 1 });

test("the real productCard() markup has no inline handler and carries data-action/data-id instead", () => {
  const productCard = loadStorefront().fn<(p: unknown) => string>("productCard");
  for (const product of [SALE_PRODUCT, QUOTE_PRODUCT]) {
    const html = productCard(product);
    assert.doesNotMatch(html, INLINE_HANDLER_ATTR, `productCard(${product.id}) emitted an inline handler`);
    assert.match(html, /data-action="toggle-favorite" data-id="p\d"/);
    assert.match(html, /data-action="toggle-compare" data-id="p\d"/);
    assert.match(html, new RegExp(`data-action="${product.sale ? "add-cart" : "quote"}" data-id="${product.id}"`));
  }
});

test("the real renderHeader() markup has no inline handler; the mobile menu toggle is a data-action", () => {
  const root = fakeElement();
  loadStorefront({ elements: { "[data-site-header]": root } }).fn<() => void>("renderHeader")();
  assert.doesNotMatch(root.innerHTML, INLINE_HANDLER_ATTR);
  assert.match(root.innerHTML, /data-action="toggle-menu"/);
});

test("the real renderCheckout() cart-line markup has no inline handler; remove is a data-action", async () => {
  const root = fakeElement();
  const store = loadStorefront({ path: "checkout.html", elements: { "[data-cart-items]": root }, storage: { "ege-cart": [{ productId: "p1", quantity: 1 }] }, api: { products: [API_SALE_PRODUCT] } });
  await store.fn<() => Promise<void>>("loadCatalog")();
  assert.doesNotMatch(root.innerHTML, INLINE_HANDLER_ATTR);
  assert.match(root.innerHTML, /data-action="remove-cart" data-id="p1"/);
});

test("the real renderProductPage() buy-actions markup has no inline handler", async () => {
  const root = fakeElement();
  const store = loadStorefront({ path: "product.html", search: "?id=p1", elements: { "[data-product-page]": root }, api: { products: [API_SALE_PRODUCT] } });
  await store.fn<() => Promise<void>>("loadCatalog")();
  assert.doesNotMatch(root.innerHTML, INLINE_HANDLER_ATTR);
  assert.match(root.innerHTML, /data-action="add-cart" data-id="p1"/);
  assert.match(root.innerHTML, /data-action="quote" data-id="p1"/);
});

test("the delegated click handler dispatches by data-action to the real underlying function, without executable code in the data attribute", () => {
  const calls: Record<string, unknown[]> = {};
  const spy = (name: string) => (...args: unknown[]) => { (calls[name] ??= []).push(args); };
  const store = loadStorefront({ path: "second-hand.html" });
  for (const name of ["addCart", "quote", "toggleFavorite", "toggleCompare", "removeCart", "calculateBtu"]) store.context[name] = spy(name);
  const handle = store.fn<(e: unknown) => void>("handleDelegatedClick");

  const fire = (action: string, id?: string, href?: string) => {
    const dataset: Record<string, string> = { action };
    if (id) dataset.id = id;
    if (href) dataset.href = href;
    handle({ target: { closest: () => ({ dataset }) } });
  };

  fire("add-cart", "p1");
  fire("quote", "p2");
  fire("toggle-favorite", "p3");
  fire("toggle-compare", "p4");
  fire("remove-cart", "p5");
  fire("calculate-btu");
  fire("navigate", undefined, "contact.html?subject=ikinci-el");
  fire("some-unknown-action", "p6");

  assert.deepEqual(calls.addCart, [["p1"]]);
  assert.deepEqual(calls.quote, [["p2"]]);
  assert.deepEqual(calls.toggleFavorite, [["p3"]]);
  assert.deepEqual(calls.toggleCompare, [["p4"]]);
  assert.deepEqual(calls.removeCart, [["p5"]]);
  assert.deepEqual(calls.calculateBtu, [[]]);
  // navigate resolves the data-href against the page and follows only same-site paths (see storefront-integrity).
  assert.equal(store.location.href, "/contact.html?subject=ikinci-el");
  const everyCall = Object.values(calls).flat();
  assert.equal(everyCall.some((args) => JSON.stringify(args).includes("p6")), false, "an unknown action must do nothing");
});

test("a click with no [data-action] ancestor is a no-op (never throws)", () => {
  const handle = loadStorefront().fn<(e: unknown) => void>("handleDelegatedClick");
  assert.doesNotThrow(() => handle({ target: { closest: () => null } }));
});
