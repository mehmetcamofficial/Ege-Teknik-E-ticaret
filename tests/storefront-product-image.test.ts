/**
 * Exercises the real storefront core, public/store-core.js (loaded via node:vm, not re-implemented
 * here) so these assertions stay tied to what actually ships to the browser.
 */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { STOREFRONT_CORE, storefrontCoreSource } from "./support/storefront-sandbox.ts";

const storeJsSource = storefrontCoreSource();

type FakeElement = { innerHTML: string; querySelector: () => null };
function fakeElement(): FakeElement {
  return { innerHTML: "", querySelector: () => null };
}

function loadStore(options: { registerSelectors?: Record<string, FakeElement>; fetchImpl?: (url: string) => Promise<{ ok: boolean; json?: () => Promise<unknown> }>; search?: string } = {}) {
  const registry = new Map(Object.entries(options.registerSelectors ?? {}));
  const storage = new Map<string, string>();
  const context: Record<string, unknown> = {
    console,
    URL,
    URLSearchParams,
    crypto,
    Intl,
    localStorage: {
      getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
      setItem: (k: string, v: string) => { storage.set(k, String(v)); },
      removeItem: (k: string) => { storage.delete(k); },
    },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { search: options.search ?? "", href: `https://shop.test/product.html${options.search ?? ""}`, origin: "https://shop.test" },
    fetch: options.fetchImpl ?? (async () => ({ ok: false })),
    document: {
      title: "",
      head: { insertAdjacentHTML() {} },
      querySelector: (sel: string) => registry.get(sel) ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
  };
  vm.createContext(context);
  new vm.Script(storeJsSource, { filename: STOREFRONT_CORE }).runInContext(context);
  return context;
}

const PRODUCT_WITH_IMAGE = {
  id: "p1",
  name: "Test Ürün",
  category: "Duvar Tipi",
  series: "Aphro",
  capacity: "9.000 BTU",
  energy: "A++",
  wifi: "Dahili",
  sale: true,
  price: 1000,
  stock: 1,
  imageUrl: "https://ege-teknik-product-images.public.blob.vercel-storage.com/products/SKU1/primary.jpg",
};
const PRODUCT_WITHOUT_IMAGE = { ...PRODUCT_WITH_IMAGE, imageUrl: "" };

test("productCard renders a real <img> with lazy loading when imageUrl is present", () => {
  const context = loadStore();
  const productCard = context.productCard as (p: unknown) => string;
  const html = productCard(PRODUCT_WITH_IMAGE);
  assert.match(html, /<img class="product-image" data-product-image="main" src="https:\/\/ege-teknik-product-images\.public\.blob\.vercel-storage\.com\/products\/SKU1\/primary\.jpg" alt="Test Ürün"[^>]*width="640" height="400"[^>]*loading="lazy">/);
  assert.doesNotMatch(html, /class="unit"/);
});

test("productCard states a missing image without inventing a product illustration", () => {
  const context = loadStore();
  const productCard = context.productCard as (p: unknown) => string;
  const html = productCard(PRODUCT_WITHOUT_IMAGE);
  assert.match(html, /class="product-image-unavailable"/);
  assert.match(html, /role="img" aria-label="Test Ürün için doğrulanmış ürün görseli mevcut değil"/);
  assert.match(html, /Doğrulanmış ürün görseli mevcut değil/);
  assert.match(html, /<svg class="ico"/);
  assert.doesNotMatch(html, /class="unit"/);
  assert.doesNotMatch(html, /<img/);
});

test("productCard escapes a quote in imageUrl/name so it cannot break out of the src/alt attribute", () => {
  const context = loadStore();
  const productCard = context.productCard as (p: unknown) => string;
  const html = productCard({ ...PRODUCT_WITH_IMAGE, name: 'Test" onerror="alert(1)' });
  // The raw quote must never survive into the attribute (that would close it early and
  // let onerror=... become a real, executable HTML attribute); it must come through escaped.
  assert.match(html, /alt="Test&quot; onerror=&quot;alert\(1\)"/);
  assert.doesNotMatch(html, /alt="Test" onerror="alert\(1\)"/);
});

test("product detail page renders the real image and drops the placeholder caption when imageUrl is present", async () => {
  const root = fakeElement();
  const context = loadStore({
    registerSelectors: { "[data-product-page]": root },
    search: "?id=p1",
    fetchImpl: async (url: string) => url === "/api/products"
      ? { ok: true, json: async () => ({ products: [{ ...PRODUCT_WITH_IMAGE, energyClass: PRODUCT_WITH_IMAGE.energy, saleMode: "online" }] }) }
      : url === "/api/products/p1"
        ? { ok: true, json: async () => ({ product: { ...PRODUCT_WITH_IMAGE, energyClass: PRODUCT_WITH_IMAGE.energy, saleMode: "online", gallery: [{ url: PRODUCT_WITH_IMAGE.imageUrl, alt: PRODUCT_WITH_IMAGE.name, width: 1200, height: 800 }], specifications: [], documents: [], warranty: null } }) }
        : { ok: false },
  });
  await (context.loadCatalog as () => Promise<void>)();
  assert.match(root.innerHTML, /<img class="detail-image" data-product-image="main" src="https:\/\/ege-teknik-product-images\.public\.blob\.vercel-storage\.com\/products\/SKU1\/primary\.jpg"/);
  assert.doesNotMatch(root.innerHTML, /Temsili görünüm/);
});

test("product detail page keeps an honest missing-image state when imageUrl is empty", async () => {
  const root = fakeElement();
  const context = loadStore({
    registerSelectors: { "[data-product-page]": root },
    search: "?id=p1",
    fetchImpl: async (url: string) => url === "/api/products"
      ? { ok: true, json: async () => ({ products: [{ ...PRODUCT_WITHOUT_IMAGE, energyClass: PRODUCT_WITHOUT_IMAGE.energy, saleMode: "online" }] }) }
      : url === "/api/products/p1"
        ? { ok: true, json: async () => ({ product: { ...PRODUCT_WITHOUT_IMAGE, energyClass: PRODUCT_WITHOUT_IMAGE.energy, saleMode: "online", gallery: [], specifications: [], documents: [], warranty: null } }) }
        : { ok: false },
  });
  await (context.loadCatalog as () => Promise<void>)();
  assert.match(root.innerHTML, /class="detail-visual missing-product-image"/);
  assert.match(root.innerHTML, /Doğrulanmış ürün görseli mevcut değil/);
  assert.match(root.innerHTML, /class="product-image-unavailable is-detail" role="img"/);
  assert.doesNotMatch(root.innerHTML, /class="unit large"/);
  assert.doesNotMatch(root.innerHTML, /class="detail-image"/);
});

test("malformed image URLs use the honest placeholder instead of issuing an asset request", () => {
  const context = loadStore();
  const productCard = context.productCard as (p: unknown) => string;
  const html = productCard({ ...PRODUCT_WITH_IMAGE, imageUrl: "javascript:alert(1)" });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /Doğrulanmış ürün görseli mevcut değil/);
});

test("a runtime image failure is replaced by the accessible neutral placeholder", () => {
  const created = { className: "", attrs: new Map<string, string>(), innerHTML: "", setAttribute(k: string, v: string) { this.attrs.set(k, v); } };
  const context = loadStore();
  (context.document as { createElement?: () => unknown }).createElement = () => created;
  let replacement: unknown;
  const image = {
    dataset: { productImage: "main" },
    matches: () => true,
    classList: { contains: (name: string) => name === "detail-image" },
    getAttribute: (name: string) => name === "alt" ? "Test Ürün" : null,
    replaceWith: (value: unknown) => { replacement = value; },
  };
  (context.handleBrokenProductImage as (event: unknown) => void)({ target: image });
  assert.equal(replacement, created);
  assert.equal(created.className, "product-image-unavailable is-detail");
  assert.equal(created.attrs.get("role"), "img");
  assert.equal(created.attrs.get("aria-label"), "Test Ürün için doğrulanmış ürün görseli mevcut değil");
  assert.match(created.innerHTML, /Doğrulanmış ürün görseli mevcut değil/);
});
