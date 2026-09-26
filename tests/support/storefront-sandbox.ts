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
import { DISTRICTS_BY_PROVINCE, EGE_TEKNIK_SERVICE_PROVINCES, publicDeliveryTraits } from "../../lib/delivery.ts";

export const ORIGIN = "https://shop.test";

/** What GET /api/checkout/charges serves today: shipping tariff pending, the service-area provinces, the province -> district dataset and the delivery-class trait table (all from lib/delivery.ts). */
export const DEFAULT_CHARGES = { shipping: { status: "pending" }, serviceProvinces: [...EGE_TEKNIK_SERVICE_PROVINCES], locations: DISTRICTS_BY_PROVINCE, deliveryTraits: publicDeliveryTraits };
export const CONFIGURED_SHIPPING = { ...DEFAULT_CHARGES, shipping: { status: "configured", amount: 600, vatRateBps: 2000 } };

export type FakeElement = {
  innerHTML: string;
  textContent: string;
  value: string;
  checked?: boolean;
  hidden?: boolean;
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

/**
 * The [data-order-confirmation] subtree renderOrderConfirmation() writes into. Each
 * [data-confirmation-*] child is a real fakeElement so assertions can read back exactly
 * what was written (innerHTML/textContent), the same way a real DOM would hold it.
 */
export function confirmationBox() {
  const children: Record<string, FakeElement & { focus?: () => void; hidden?: boolean }> = {
    "[data-confirmation-heading]": { ...fakeElement(), focus: () => {} },
    "[data-confirmation-number]": fakeElement(),
    "[data-confirmation-items]": fakeElement(),
    "[data-confirmation-subtotal]": fakeElement(),
    "[data-confirmation-vat]": fakeElement(),
    "[data-confirmation-shipping]": fakeElement(),
    "[data-confirmation-installation-row]": { ...fakeElement(), hidden: true },
    "[data-confirmation-installation]": fakeElement(),
    "[data-confirmation-total]": fakeElement(),
    "[data-confirmation-delivery]": fakeElement(),
  };
  const box = { ...fakeElement(), hidden: true, scrollIntoView: () => {}, querySelector: (selector: string) => children[selector] ?? null, children };
  return box;
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
    deliveryClass: "installed_delivery",
    saleMode: "online",
    imageUrl: "",
    vatRateBps: 2000,
    shortDescription: "Kısa ürün açıklaması.",
    description: "Ayrıntılı ürün açıklaması.",
    gallery: [],
    specifications: [],
    documents: [],
    warranty: null,
    ...overrides,
  };
}

export function loadStorefront(options: {
  path?: string;
  search?: string;
  referrer?: string;
  storage?: Record<string, unknown>;
  elements?: Record<string, FakeElement>;
  featured?: ReturnType<typeof featuredCard>[];
  api?: { products?: ApiValue; detail?: Record<string, unknown> | "fail"; secondHand?: ApiValue; blog?: ApiValue; order?: () => Promise<unknown>; charges?: Record<string, unknown>; reviews?: ((url: string) => unknown) | Record<string, unknown> | "fail"; reviewPost?: (body: unknown, headers: Record<string, string>) => { status: number; body: unknown }; analyticsFail?: boolean };
} = {}) {
  const storage = new Map(Object.entries(options.storage ?? {}).map(([k, v]) => [k, JSON.stringify(v)]));
  const search = options.search ?? "";
  const location = { href: `${ORIGIN}/${options.path ?? "index.html"}${search}`, origin: ORIGIN, search, pathname: `/${options.path ?? "index.html"}` };
  const elements = options.elements ?? {};
  const featured = options.featured ?? [];
  const api = options.api ?? {};
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  const fetchCalls: string[] = [];
  const orderBodies: string[] = [];
  const reviewBodies: { body: unknown; headers: Record<string, string> }[] = [];
  const analyticsBodies: { body: unknown; init: Record<string, unknown> }[] = [];

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
    fetch: (url: string, init?: { body?: string; method?: string; headers?: Record<string, string>; keepalive?: boolean }) => {
      fetchCalls.push(url);
      if (url === "/api/analytics/event") { analyticsBodies.push({ body: JSON.parse(init?.body ?? "{}"), init: { ...init } }); return api.analyticsFail ? Promise.reject(new Error("network")) : Promise.resolve({ ok: true, status: 202, json: async () => ({ ok: true }) }); }
      if (url === "/api/orders" && init?.body) orderBodies.push(init.body);
      if (/^\/api\/products\/[^/?]+\/reviews/.test(url)) {
        if (init?.method === "POST") { reviewBodies.push({ body: JSON.parse(init.body ?? "{}"), headers: init.headers ?? {} }); const r = api.reviewPost ? api.reviewPost(JSON.parse(init.body ?? "{}"), init.headers ?? {}) : { status: 202, body: { ok: true, status: "pending" } }; return Promise.resolve({ ok: r.status < 300, status: r.status, json: async () => r.body }); }
        if (api.reviews === "fail") return Promise.resolve({ ok: false, status: 503, json: async () => ({}) });
        const data = typeof api.reviews === "function" ? api.reviews(url) : api.reviews ?? { summary: { count: 0, average: null, distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } }, reviews: [], nextCursor: null };
        return Promise.resolve({ ok: true, status: 200, json: async () => data });
      }
      if (url === "/api/products") return respond(api.products, "products");
      if (url.startsWith("/api/products/")) {
        if (api.detail === "fail") return Promise.resolve({ ok: false, status: 503, json: async () => ({}) });
        const id = decodeURIComponent(url.slice("/api/products/".length));
        const product = api.detail ?? (Array.isArray(api.products) ? api.products.find((p) => p.id === id) : undefined);
        return product
          ? Promise.resolve({ ok: true, status: 200, json: async () => ({ product }) })
          : Promise.resolve({ ok: false, status: 404, json: async () => ({ error: "Ürün bulunamadı." }) });
      }
      if (url === "/api/second-hand") return respond(api.secondHand, "products");
      if (url === "/api/blog") return respond(api.blog, "posts");
      if (url === "/api/legal/required") return Promise.resolve({ ok: true, status: 200, json: async () => ({ documents: [{ slug: "distance-sales", title: "PREVIEW TEST — Mesafeli Satış", versionId: "ver-ds-1" }] }) });
      if (url === "/api/checkout/charges") return Promise.resolve({ ok: true, status: 200, json: async () => api.charges ?? DEFAULT_CHARGES });
      if (url === "/api/orders" && api.order) return api.order();
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    },
    document: {
      title: "",
      referrer: options.referrer ?? "",
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
    orderBodies,
    reviewBodies,
    analyticsBodies,
    document: context.document as { title: string },
  };
}

/** A tag-level event-handler attribute (<x ... onerror=...>) - what an injected payload would need to execute. */
export const LIVE_HANDLER_ATTR = /<[a-z][a-z0-9]*\b[^>]*\son[a-z]+\s*=/i;
