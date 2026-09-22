/**
 * Exercises the real public/store.js file (loaded via node:vm, not re-implemented
 * here) so these assertions stay tied to what actually ships to the browser.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const storeJsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "store.js");
const storeJsSource = readFileSync(storeJsPath, "utf8");

type FakeElement = { innerHTML: string; querySelector: () => null };
function fakeElement(): FakeElement {
  return { innerHTML: "", querySelector: () => null };
}

function loadStore(options: { registerSelectors?: Record<string, FakeElement>; fetchImpl?: (url: string) => Promise<{ ok: boolean; json?: () => Promise<unknown> }>; search?: string } = {}) {
  const registry = new Map(Object.entries(options.registerSelectors ?? {}));
  const storage = new Map<string, string>();
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
      addEventListener: () => {},
    },
  };
  vm.createContext(context);
  new vm.Script(storeJsSource, { filename: "store.js" }).runInContext(context);
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
  assert.match(html, /<img class="product-image" src="https:\/\/ege-teknik-product-images\.public\.blob\.vercel-storage\.com\/products\/SKU1\/primary\.jpg" alt="Test Ürün" loading="lazy">/);
  assert.doesNotMatch(html, /class="unit"/);
});

test("productCard falls back to the .unit placeholder when imageUrl is empty", () => {
  const context = loadStore();
  const productCard = context.productCard as (p: unknown) => string;
  const html = productCard(PRODUCT_WITHOUT_IMAGE);
  assert.match(html, /<div class="unit"><\/div>/);
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
    fetchImpl: async (url: string) => (url === "/api/products" ? { ok: true, json: async () => ({ products: [{ ...PRODUCT_WITH_IMAGE, energyClass: PRODUCT_WITH_IMAGE.energy, saleMode: "online" }] }) } : { ok: false }),
  });
  await (context.loadCatalog as () => Promise<void>)();
  assert.match(root.innerHTML, /<img class="detail-image" src="https:\/\/ege-teknik-product-images\.public\.blob\.vercel-storage\.com\/products\/SKU1\/primary\.jpg"/);
  assert.doesNotMatch(root.innerHTML, /Temsili görünüm/);
});

test("product detail page keeps the placeholder + caption when imageUrl is empty", async () => {
  const root = fakeElement();
  const context = loadStore({
    registerSelectors: { "[data-product-page]": root },
    search: "?id=p1",
    fetchImpl: async (url: string) => (url === "/api/products" ? { ok: true, json: async () => ({ products: [{ ...PRODUCT_WITHOUT_IMAGE, energyClass: PRODUCT_WITHOUT_IMAGE.energy, saleMode: "online" }] }) } : { ok: false }),
  });
  await (context.loadCatalog as () => Promise<void>)();
  assert.match(root.innerHTML, /class="unit large"/);
  assert.match(root.innerHTML, /Temsili görünüm • Gerçek bayi görselleri eklenecek/);
  assert.doesNotMatch(root.innerHTML, /class="detail-image"/);
});
