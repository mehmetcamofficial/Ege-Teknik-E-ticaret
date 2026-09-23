/**
 * Runs the real public/store.js in a node:vm sandbox that models the parts of a browser
 * the storefront touches (URL, location, fetch, storage, a selector registry), so tests
 * assert against the exact file the browser receives. Classic-script `function`
 * declarations land on the sandbox global; `const` bindings deliberately do not.
 *
 * Not a *.test.ts file, so the test runner's glob does not execute it on its own.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

export const ORIGIN = "https://shop.test";

export type FakeElement = {
  innerHTML: string;
  textContent: string;
  value: string;
  checked?: boolean;
  dataset: Record<string, string>;
  style: { setProperty: (name: string, value: string) => void };
  classList: { add: () => void; remove: () => void; toggle: () => void };
  querySelector: (selector: string) => unknown;
  querySelectorAll: (selector: string) => unknown[];
  addEventListener: () => void;
  replaceChildren: (...nodes: { textContent?: string }[]) => void;
  removed?: boolean;
  remove: () => void;
};

export function fakeElement(): FakeElement {
  const el: FakeElement = {
    innerHTML: "",
    textContent: "",
    value: "",
    dataset: {},
    style: { setProperty: () => {} },
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    replaceChildren: (...nodes) => {
      el.textContent = nodes.map((n) => n.textContent ?? "").join("");
    },
    remove: () => {
      el.removed = true;
    },
  };
  return el;
}

/** A homepage featured card: data-featured-product plus its data-product-field children. */
export function featuredCard(productId: string) {
  const fields = { name: fakeElement(), price: fakeElement(), stock: fakeElement(), capacity: fakeElement(), sku: fakeElement() };
  return {
    dataset: { featuredProduct: productId },
    fields,
    querySelectorAll: (selector: string) => {
      const field = /data-product-field="(\w+)"/.exec(selector)?.[1] as keyof typeof fields | undefined;
      return field && fields[field] ? [fields[field]] : [];
    },
  };
}

type ApiValue = Record<string, unknown>[] | "fail" | "pending";

/** GET /api/products item shape (saleMode/energyClass, which loadCatalog maps). */
export function apiProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: "synthetic-product-1",
    name: "Sentetik Ürün 12000 BTU/h",
    category: "Duvar Tipi",
    series: "Sentetik",
    capacity: "12000 BTU/h",
    energyClass: "",
    wifi: "",
    sku: "SKU-SYNTH-1",
    price: 12_345,
    stock: 3,
    saleMode: "online",
    imageUrl: "",
    ...overrides,
  };
}

export function loadStorefront(options: {
  path?: string;
  search?: string;
  storage?: Record<string, unknown>;
  elements?: Record<string, FakeElement>;
  featured?: ReturnType<typeof featuredCard>[];
  api?: { products?: ApiValue; secondHand?: ApiValue; blog?: ApiValue; order?: () => Promise<unknown> };
} = {}) {
  const storage = new Map(Object.entries(options.storage ?? {}).map(([k, v]) => [k, JSON.stringify(v)]));
  const search = options.search ?? "";
  const location = { href: `${ORIGIN}/${options.path ?? "index.html"}${search}`, origin: ORIGIN, search };
  const elements = options.elements ?? {};
  const featured = options.featured ?? [];
  const api = options.api ?? {};
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  const fetchCalls: string[] = [];

  const respond = (value: ApiValue | undefined, key: string) => {
    if (value === "pending") return new Promise(() => {});
    if (value === "fail") return Promise.resolve({ ok: false, status: 503, json: async () => ({}) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ [key]: value ?? [] }) });
  };

  const context: Record<string, unknown> = {
    console,
    URL,
    URLSearchParams,
    Intl,
    crypto,
    setTimeout,
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => { storage.set(k, String(v)); },
      removeItem: (k: string) => { storage.delete(k); },
    },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location,
    FormData: class {
      fields: Record<string, string>;
      constructor(form: { fields: Record<string, string> }) { this.fields = form.fields; }
      get(name: string) { return this.fields[name] ?? ""; }
    },
    fetch: (url: string) => {
      fetchCalls.push(url);
      if (url === "/api/products") return respond(api.products, "products");
      if (url === "/api/second-hand") return respond(api.secondHand, "products");
      if (url === "/api/blog") return respond(api.blog, "posts");
      if (url === "/api/orders" && api.order) return api.order();
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    },
    document: {
      title: "",
      head: { insertAdjacentHTML: () => {} },
      querySelector: (selector: string) => elements[selector] ?? null,
      querySelectorAll: (selector: string) => (selector === "[data-featured-product]" ? featured : []),
      addEventListener: (type: string, fn: (event: unknown) => void) => { (listeners[type] ??= []).push(fn); },
      createTextNode: (text: string) => ({ textContent: String(text) }),
    },
  };
  vm.createContext(context);
  vm.runInContext(readFileSync("public/store.js", "utf8"), context, { filename: "public/store.js" });

  return {
    // The sandbox's own functions, looked up by name; each test casts to the signature it calls.
    fn: <T extends (...args: never[]) => unknown>(name: string) => context[name] as T,
    context,
    storage,
    location,
    elements,
    featured,
    listeners,
    fetchCalls,
    document: context.document as { title: string },
  };
}

/** A tag-level event-handler attribute (<x ... onerror=...>) - what an injected payload would need to execute. */
export const LIVE_HANDLER_ATTR = /<[a-z][a-z0-9]*\b[^>]*\son[a-z]+\s*=/i;
