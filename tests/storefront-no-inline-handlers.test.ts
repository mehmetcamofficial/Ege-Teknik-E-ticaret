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
import vm from "node:vm";

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

type FakeElement = { innerHTML: string; querySelector: () => null; dataset?: Record<string, string> };
function fakeElement(): FakeElement {
  return { innerHTML: "", querySelector: () => null };
}

function loadStore(options: { registerSelectors?: Record<string, FakeElement>; fetchImpl?: (url: string) => Promise<{ ok: boolean; json?: () => Promise<unknown> }>; search?: string } = {}) {
  const registry = new Map(Object.entries(options.registerSelectors ?? {}));
  const storage = new Map<string, string>();
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const context: Record<string, unknown> = {
    console,
    URLSearchParams,
    crypto,
    Intl,
    localStorage: {
      getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
      setItem: (k: string, v: string) => { storage.set(k, String(v)); },
      removeItem: (k: string) => { storage.delete(k); },
    },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { search: options.search ?? "", href: "" },
    fetch: options.fetchImpl ?? (async () => ({ ok: false })),
    document: {
      title: "",
      head: { insertAdjacentHTML() {} },
      querySelector: (sel: string) => registry.get(sel) ?? null,
      querySelectorAll: () => [],
      addEventListener: (type: string, fn: (e: unknown) => void) => { (listeners[type] ??= []).push(fn); },
    },
  };
  vm.createContext(context);
  new vm.Script(storeJsSource, { filename: "store.js" }).runInContext(context);
  return { context, listeners };
}

const SALE_PRODUCT = { id: "p1", name: "Test Ürün", category: "Duvar Tipi", series: "Aphro", capacity: "9.000 BTU", energy: "A++", wifi: "Dahili", sale: true, price: 1000, stock: 1, imageUrl: "" };
const QUOTE_PRODUCT = { ...SALE_PRODUCT, id: "p2", sale: false };

test("the real productCard() markup has no inline handler and carries data-action/data-id instead", () => {
  const { context } = loadStore();
  const productCard = context.productCard as (p: unknown) => string;
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
  const { context } = loadStore({ registerSelectors: { "[data-site-header]": root } });
  (context.renderHeader as () => void)();
  assert.doesNotMatch(root.innerHTML, INLINE_HANDLER_ATTR);
  assert.match(root.innerHTML, /data-action="toggle-menu"/);
});

test("the real renderCheckout() cart-line markup has no inline handler; remove is a data-action", () => {
  const root = fakeElement();
  const { context } = loadStore({ registerSelectors: { "[data-cart-items]": root } });
  // saveCart/getCart are `const`, so vm doesn't expose them as context properties (only
  // `function` declarations are) - write the same localStorage key they use directly.
  (context.localStorage as { setItem: (k: string, v: string) => void }).setItem("ege-cart", JSON.stringify([{ productId: "p1", quantity: 1 }]));
  // getProducts() has no catalog loaded in this harness, so the line renders as "blocked" -
  // still exercises the exact same removeCart button markup path.
  (context.renderCheckout as () => void)();
  assert.doesNotMatch(root.innerHTML, INLINE_HANDLER_ATTR);
  assert.match(root.innerHTML, /data-action="remove-cart" data-id="p1"/);
});

test("the real renderProductPage() buy-actions markup has no inline handler", async () => {
  const root = fakeElement();
  const { context } = loadStore({
    registerSelectors: { "[data-product-page]": root },
    search: "?id=p1",
    fetchImpl: async (url: string) => (url === "/api/products" ? { ok: true, json: async () => ({ products: [{ ...SALE_PRODUCT, energyClass: SALE_PRODUCT.energy, saleMode: "online" }] }) } : { ok: false }),
  });
  await (context.loadCatalog as () => Promise<void>)();
  assert.doesNotMatch(root.innerHTML, INLINE_HANDLER_ATTR);
  assert.match(root.innerHTML, /data-action="add-cart" data-id="p1"/);
  assert.match(root.innerHTML, /data-action="quote" data-id="p1"/);
});

test("the delegated click handler dispatches by data-action to the real underlying function, without executable code in the data attribute", () => {
  const calls: Record<string, unknown[]> = {};
  const spy = (name: string) => (...args: unknown[]) => { (calls[name] ??= []).push(args); };
  const { context } = loadStore();
  for (const name of ["addCart", "quote", "toggleFavorite", "toggleCompare", "removeCart", "calculateBtu"]) context[name] = spy(name);
  context.location = { href: "" };
  const handle = context.handleDelegatedClick as (e: unknown) => void;

  const fire = (action: string, id?: string, href?: string) => {
    const dataset: Record<string, string> = { action };
    if (id) dataset.id = id;
    if (href) dataset.href = href;
    const el = { dataset };
    handle({ target: { closest: () => el } });
  };

  fire("add-cart", "p1");
  fire("quote", "p2");
  fire("toggle-favorite", "p3");
  fire("toggle-compare", "p4");
  fire("remove-cart", "p5");
  fire("calculate-btu");
  fire("navigate", undefined, "contact.html?subject=ikinci-el");

  assert.deepEqual(calls.addCart, [["p1"]]);
  assert.deepEqual(calls.quote, [["p2"]]);
  assert.deepEqual(calls.toggleFavorite, [["p3"]]);
  assert.deepEqual(calls.toggleCompare, [["p4"]]);
  assert.deepEqual(calls.removeCart, [["p5"]]);
  assert.deepEqual(calls.calculateBtu, [[]]);
  assert.equal((context.location as { href: string }).href, "contact.html?subject=ikinci-el");
});

test("a click with no [data-action] ancestor is a no-op (never throws)", () => {
  const { context } = loadStore();
  const handle = context.handleDelegatedClick as (e: unknown) => void;
  assert.doesNotThrow(() => handle({ target: { closest: () => null } }));
});
