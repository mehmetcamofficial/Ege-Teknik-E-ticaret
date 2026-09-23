import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

type CartEntry = { productId: string; quantity: number };
type Product = { id: string; name: string; capacity: string; price: number; sale: boolean };
type KeyStore = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

// Real backend-shaped ids, deliberately unlike the legacy "aphro-09" seed ids.
const BACKEND_ID = "aphro-inverter-duvar-tipi-split-klima-r32-9000-btu-h-1";
const FAIRY_ID = "gree-fairy-a-12-000-btu-18";
const QUOTE_ID = "salon-tipi-48000-quote-only";

const products: Product[] = [
  { id: BACKEND_ID, name: "GREE Aphro 9.000 BTU", capacity: "9.000 BTU", price: 32_999, sale: true },
  { id: FAIRY_ID, name: "GREE Fairy 12.000 BTU", capacity: "12.000 BTU", price: 46_300, sale: true },
  { id: QUOTE_ID, name: "GREE Salon Tipi", capacity: "48.000 BTU", price: 0, sale: false },
];

// What GET /api/products actually returns: saleMode/energyClass, which loadCatalog maps.
const apiProducts = products.map((p) => ({ ...p, saleMode: p.sale ? "online" : "quote", energyClass: "A++", wifi: "Dahili", sale: undefined }));

type StorefrontApi = {
  normalizeCartEntries: (raw: unknown, knownIds: Set<string> | null) => CartEntry[];
  cartLines: (entries: CartEntry[], products: Product[]) => { productId: string; quantity: number; product: Product | null; available: boolean }[];
  cartTotal: (lines: unknown) => number;
  orderItemsPayload: (entries: CartEntry[], products: Product[]) => CartEntry[];
  buildOrderPayload: (fields: Record<string, string>, entries: CartEntry[], products: Product[]) => Record<string, unknown>;
  orderAttemptKey: (store: KeyStore) => string;
  clearOrderAttemptKey: (store: KeyStore) => void;
  catalogAuthoritative: () => boolean;
  loadCatalog: () => Promise<void>;
  loadLegalRequirements: () => Promise<unknown>;
  acceptedLegalVersionIds: (boxes: unknown) => string[];
  legalConsentsComplete: (requirements: unknown, acceptedIds: string[]) => boolean;
  submitOrder: (event: unknown) => Promise<void>;
  addCart: (id: string) => void;
  removeCart: (id: string) => void;
  pruneCart: () => number;
  getProducts?: unknown;
};

// Values built inside the sandbox carry that realm's prototypes, so deepEqual would reject
// them on identity alone. Round-tripping compares the data, which is what matters here.
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function makeStore(data: Record<string, string> = {}) {
  return {
    data,
    getItem(key: string) { return key in data ? data[key] : null; },
    setItem(key: string, value: string) { data[key] = String(value); },
    removeItem(key: string) { delete data[key]; },
  };
}

/**
 * Loads the shipped public/store.js into a sandbox, so these assertions run against the exact
 * file the browser receives rather than a copy of its logic. Classic-script function
 * declarations land on the sandbox global; const/arrow bindings deliberately do not.
 */
function loadStorefront(options: { fetch?: (url: string, init?: { headers?: Record<string, string>; body?: string }) => Promise<unknown>; cart?: unknown } = {}) {
  const noop = () => {};
  const element = {
    textContent: "", innerHTML: "", value: "", dataset: {},
    classList: { add: noop, remove: noop }, style: { setProperty: noop },
    querySelector: () => null, querySelectorAll: () => [], addEventListener: noop,
    replaceChildren: noop, insertAdjacentHTML: noop,
  };
  const localStorage = makeStore(options.cart === undefined ? {} : { "ege-cart": JSON.stringify(options.cart) });
  const sessionStorage = makeStore();
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const context: Record<string, unknown> = {
    document: { querySelector: () => null, querySelectorAll: () => [], addEventListener: noop, head: element, title: "" },
    localStorage, sessionStorage,
    location: { search: "", href: "" },
    console, crypto, URLSearchParams, setTimeout,
    FormData: class {
      form: { fields: Record<string, string> };
      constructor(form: { fields: Record<string, string> }) { this.form = form; }
      get(name: string) { return this.form.fields[name] ?? ""; }
    },
    fetch: (url: string, init: { headers?: Record<string, string>; body?: string } = {}) => {
      calls.push({ url, headers: init.headers ?? {}, body: init.body ?? "" });
      return options.fetch ? options.fetch(url, init) : Promise.reject(new Error("offline"));
    },
  };
  vm.createContext(context);
  vm.runInContext(readFileSync("public/store.js", "utf8"), context);
  return { ctx: context as unknown as StorefrontApi, localStorage, sessionStorage, calls };
}

const jsonResponse = (status: number, body: unknown) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
export const legalDocuments = [{ slug: "distance-sales", title: "PREVIEW TEST — Mesafeli Satış", versionId: "ver-ds-1" }, { slug: "pre-information", title: "PREVIEW TEST — Ön Bilgilendirme", versionId: "ver-pi-1" }];
const catalogFetch = (orderResponse?: () => Promise<unknown>) => (url: string) =>
  url === "/api/products" ? jsonResponse(200, { products: apiProducts })
    : url === "/api/legal/required" ? jsonResponse(200, { documents: legalDocuments })
    : (orderResponse ? orderResponse() : Promise.reject(new Error("offline")));

const checkoutForm = (ticked: string[] = legalDocuments.map((d) => d.versionId)) => {
  const button = { disabled: false, textContent: "Siparişi tamamla" };
  const result = { textContent: "", innerHTML: "" };
  const form = {
    fields: { customerName: "Ada Lovelace", phone: "05001112233", email: "ada@example.test", city: "İzmir", address: "Kuşadası 1 Sokak No 1", provider: "PayTR" },
    querySelector: (selector: string) => (selector === "button.primary" ? button : selector === "[data-order-result]" ? result : null),
    querySelectorAll: (selector: string) => (selector === "[data-legal-version]" ? legalDocuments.map((d) => ({ checked: ticked.includes(d.versionId), dataset: { legalVersion: d.versionId } })) : []),
  };
  return { form, button, result, event: { preventDefault: () => {}, currentTarget: form } };
};

test("storefront exposes its cart logic and is not authoritative before the API answers", () => {
  const { ctx } = loadStorefront();
  for (const fn of ["normalizeCartEntries", "cartLines", "cartTotal", "orderItemsPayload", "buildOrderPayload", "orderAttemptKey", "submitOrder", "loadCatalog"]) {
    assert.equal(typeof (ctx as unknown as Record<string, unknown>)[fn], "function", `${fn} should be available`);
  }
  assert.equal(ctx.catalogAuthoritative(), false);
});

test("loading /api/products makes the catalog authoritative", async () => {
  const { ctx } = loadStorefront({ fetch: catalogFetch() });
  await ctx.loadCatalog();
  assert.equal(ctx.catalogAuthoritative(), true);
});

test("cart entries keep only the backend product id and quantity", () => {
  const { ctx } = loadStorefront();
  const entries = plain(ctx.normalizeCartEntries([{ productId: BACKEND_ID, quantity: 2 }], null));
  assert.deepEqual(entries, [{ productId: BACKEND_ID, quantity: 2 }]);
  assert.deepEqual(Object.keys(entries[0]).sort(), ["productId", "quantity"]);
});

test("legacy cart objects migrate to id and quantity, dropping their stored price", () => {
  const { ctx } = loadStorefront();
  const entries = plain(ctx.normalizeCartEntries([{ id: "aphro-09", name: "GREE Aphro", price: 1, qty: 2, sale: true }], null));
  assert.deepEqual(entries, [{ productId: "aphro-09", quantity: 2 }]);
  assert.equal("price" in entries[0], false);
});

test("stale legacy ids are purged from storage once the backend catalog loads", async () => {
  const legacyCart = [{ id: "aphro-09", name: "GREE Aphro", price: 32_999, qty: 1 }, { productId: BACKEND_ID, quantity: 2 }];
  const { ctx, localStorage } = loadStorefront({ fetch: catalogFetch(), cart: legacyCart });
  await ctx.loadCatalog();
  assert.deepEqual(JSON.parse(localStorage.getItem("ege-cart")!), [{ productId: BACKEND_ID, quantity: 2 }]);
});

test("malformed cart storage never throws and yields no entries", () => {
  const { ctx } = loadStorefront();
  for (const raw of [null, undefined, "not-an-array", 42, [null], [{}], [{ id: 5 }], [{ productId: "" }], [{ productId: "has space" }], [{ productId: "<img src=x onerror=alert(1)>" }]]) {
    assert.deepEqual(plain(ctx.normalizeCartEntries(raw, null)), [], `rejected input: ${JSON.stringify(raw)}`);
  }
});

test("a cart of only legacy ids survives catalog load as an empty cart", async () => {
  const { ctx, localStorage } = loadStorefront({ fetch: catalogFetch(), cart: [{ id: "aphro-09", qty: 1 }, { id: "pular-12", qty: 3 }] });
  await ctx.loadCatalog();
  assert.deepEqual(JSON.parse(localStorage.getItem("ege-cart")!), []);
});

test("duplicate lines merge and quantities stay inside the API bounds", () => {
  const { ctx } = loadStorefront();
  assert.deepEqual(plain(ctx.normalizeCartEntries([{ productId: BACKEND_ID, quantity: 1 }, { productId: BACKEND_ID, quantity: 2 }], null)), [{ productId: BACKEND_ID, quantity: 3 }]);
  assert.deepEqual(plain(ctx.normalizeCartEntries([{ productId: BACKEND_ID, quantity: 99 }], null)), [{ productId: BACKEND_ID, quantity: 10 }]);
  assert.deepEqual(plain(ctx.normalizeCartEntries([{ productId: BACKEND_ID, quantity: 0 }], null)), [{ productId: BACKEND_ID, quantity: 1 }]);
  assert.deepEqual(plain(ctx.normalizeCartEntries([{ productId: BACKEND_ID, quantity: -5 }], null)), [{ productId: BACKEND_ID, quantity: 1 }]);
  assert.deepEqual(plain(ctx.normalizeCartEntries([{ productId: BACKEND_ID, quantity: 2.7 }], null)), [{ productId: BACKEND_ID, quantity: 2 }]);
  assert.equal(ctx.normalizeCartEntries(Array.from({ length: 30 }, (_, i) => ({ productId: `product-${i}`, quantity: 1 })), null).length, 20);
});

test("a tampered localStorage price cannot influence the displayed total", () => {
  const { ctx } = loadStorefront();
  const tampered = ctx.normalizeCartEntries([{ productId: BACKEND_ID, quantity: 1, price: 1 }], null);
  assert.equal(ctx.cartTotal(ctx.cartLines(tampered, products)), 32_999, "total must come from the catalog price");
});

test("totals multiply catalog price by quantity and ignore unsellable lines", () => {
  const { ctx } = loadStorefront();
  const entries = ctx.normalizeCartEntries([{ productId: BACKEND_ID, quantity: 2 }, { productId: QUOTE_ID, quantity: 1 }, { productId: "ghost-product", quantity: 1 }], null);
  const lines = ctx.cartLines(entries, products);
  assert.equal(ctx.cartTotal(lines), 65_998);
  assert.equal(lines.find((l) => l.productId === "ghost-product")!.available, false);
  assert.equal(lines.find((l) => l.productId === QUOTE_ID)!.available, false);
});

test("the order payload carries no price, VAT or total and only sellable items", () => {
  const { ctx } = loadStorefront();
  const entries = ctx.normalizeCartEntries([{ productId: BACKEND_ID, quantity: 2 }, { productId: QUOTE_ID, quantity: 1 }], null);
  const payload = plain(ctx.buildOrderPayload({ customerName: "Ada", phone: "05001112233", email: "a@b.test", city: "İzmir", address: "Sokak No 1", paymentProvider: "PayTR" }, entries, products));
  assert.deepEqual(Object.keys(payload).sort(), ["address", "city", "customerName", "email", "installation", "items", "legalAcceptances", "note", "paymentProvider", "phone"]);
  for (const forbidden of ["price", "unitPrice", "total", "subtotal", "vat", "vatTotal", "vatRateBps", "lineTotal"]) {
    assert.equal(forbidden in payload, false, `payload must not contain ${forbidden}`);
  }
  assert.deepEqual(payload.items, [{ productId: BACKEND_ID, quantity: 2 }]);
});

test("an idempotency key is generated once and reused across retries", () => {
  const { ctx, sessionStorage } = loadStorefront();
  const first = ctx.orderAttemptKey(sessionStorage);
  assert.match(first, /^[0-9a-f-]{36}$/);
  assert.equal(ctx.orderAttemptKey(sessionStorage), first);
  ctx.clearOrderAttemptKey(sessionStorage);
  assert.equal(sessionStorage.getItem("ege-order-attempt"), null);
  assert.notEqual(ctx.orderAttemptKey(sessionStorage), first);
});

test("checkout posts id and quantity only, with an Idempotency-Key header", async () => {
  const { ctx, calls } = loadStorefront({ fetch: catalogFetch(() => jsonResponse(201, { ok: true, orderNumber: "ETS-20260922-ABC123" })), cart: [{ productId: BACKEND_ID, quantity: 2 }] });
  await ctx.loadCatalog();
  await ctx.loadLegalRequirements();
  await ctx.submitOrder(checkoutForm().event);
  const order = calls.find((c) => c.url === "/api/orders")!;
  assert.ok(order, "an order request should have been sent");
  assert.match(order.headers["idempotency-key"], /^[0-9a-f-]{36}$/);
  const body = JSON.parse(order.body);
  assert.deepEqual(body.items, [{ productId: BACKEND_ID, quantity: 2 }]);
  for (const forbidden of ["price", "total", "subtotal", "vatTotal"]) assert.equal(forbidden in body, false);
});

test("a confirmed order clears the cart and the attempt key", async () => {
  const { ctx, localStorage, sessionStorage } = loadStorefront({ fetch: catalogFetch(() => jsonResponse(201, { ok: true, orderNumber: "ETS-20260922-ABC123" })), cart: [{ productId: BACKEND_ID, quantity: 1 }] });
  await ctx.loadCatalog();
  await ctx.loadLegalRequirements();
  await ctx.submitOrder(checkoutForm().event);
  assert.deepEqual(JSON.parse(localStorage.getItem("ege-cart")!), []);
  assert.equal(sessionStorage.getItem("ege-order-attempt"), null);
});

test("a network failure keeps the cart and reuses the same key on retry", async () => {
  const { ctx, localStorage, sessionStorage, calls } = loadStorefront({ fetch: catalogFetch(() => Promise.reject(new Error("offline"))), cart: [{ productId: BACKEND_ID, quantity: 2 }] });
  await ctx.loadCatalog();
  await ctx.loadLegalRequirements();
  const first = checkoutForm();
  await ctx.submitOrder(first.event);
  assert.deepEqual(JSON.parse(localStorage.getItem("ege-cart")!), [{ productId: BACKEND_ID, quantity: 2 }], "cart must survive a failure");
  const keyAfterFailure = sessionStorage.getItem("ege-order-attempt");
  assert.ok(keyAfterFailure);
  assert.equal(first.button.disabled, false, "the button must be re-enabled for a retry");
  await ctx.submitOrder(checkoutForm().event);
  const orderCalls = calls.filter((c) => c.url === "/api/orders");
  assert.equal(orderCalls.length, 2);
  assert.equal(orderCalls[0].headers["idempotency-key"], orderCalls[1].headers["idempotency-key"], "a retry must reuse the key so the server can dedupe");
});

test("an out-of-stock rejection keeps the cart and surfaces the server message", async () => {
  const { ctx, localStorage, sessionStorage } = loadStorefront({ fetch: catalogFetch(() => jsonResponse(409, { error: "GREE Aphro 9.000 BTU için yeterli stok yok." })), cart: [{ productId: BACKEND_ID, quantity: 2 }] });
  await ctx.loadCatalog();
  await ctx.loadLegalRequirements();
  const checkout = checkoutForm();
  await ctx.submitOrder(checkout.event);
  assert.deepEqual(JSON.parse(localStorage.getItem("ege-cart")!), [{ productId: BACKEND_ID, quantity: 2 }]);
  assert.match(checkout.result.textContent, /stok yok/);
  assert.ok(sessionStorage.getItem("ege-order-attempt"), "the key is kept so a retry stays idempotent");
});

test("a validation rejection keeps the cart intact", async () => {
  const { ctx, localStorage } = loadStorefront({ fetch: catalogFetch(() => jsonResponse(400, { error: "Sipariş bilgilerini kontrol edin." })), cart: [{ productId: BACKEND_ID, quantity: 1 }] });
  await ctx.loadCatalog();
  await ctx.loadLegalRequirements();
  const checkout = checkoutForm();
  await ctx.submitOrder(checkout.event);
  assert.deepEqual(JSON.parse(localStorage.getItem("ege-cart")!), [{ productId: BACKEND_ID, quantity: 1 }]);
  assert.match(checkout.result.textContent, /kontrol edin/);
});

test("an unavailable catalog can never place an order", async () => {
  const { ctx, calls } = loadStorefront({ fetch: () => Promise.reject(new Error("offline")), cart: [{ productId: "aphro-09", quantity: 1 }] });
  await ctx.loadCatalog();
  assert.equal(ctx.catalogAuthoritative(), false);
  const checkout = checkoutForm();
  await ctx.submitOrder(checkout.event);
  assert.equal(calls.filter((c) => c.url === "/api/orders").length, 0, "no order may be sent without the served catalog");
  assert.match(checkout.result.textContent, /doğrulanamadı/);
});

test("checkout refuses when nothing in the cart is sellable", async () => {
  const { ctx, calls } = loadStorefront({ fetch: catalogFetch(), cart: [{ productId: QUOTE_ID, quantity: 1 }] });
  await ctx.loadCatalog();
  await ctx.loadLegalRequirements();
  const checkout = checkoutForm();
  await ctx.submitOrder(checkout.event);
  assert.equal(calls.filter((c) => c.url === "/api/orders").length, 0);
  assert.match(checkout.result.textContent, /satın alınabilir ürün yok/);
});

test("checkout blocks submission when a required legal box is unticked", async () => {
  const { ctx, calls, localStorage } = loadStorefront({ fetch: catalogFetch(() => jsonResponse(201, { ok: true, orderNumber: "X" })), cart: [{ productId: BACKEND_ID, quantity: 1 }] });
  await ctx.loadCatalog();
  await ctx.loadLegalRequirements();
  for (const ticked of [[], ["ver-ds-1"], ["ver-pi-1"]]) {
    const checkout = checkoutForm(ticked);
    await ctx.submitOrder(checkout.event);
    assert.match(checkout.result.textContent, /yasal metinleri kabul/);
  }
  assert.equal(calls.filter((c) => c.url === "/api/orders").length, 0, "no order request without every acceptance");
  assert.deepEqual(JSON.parse(localStorage.getItem("ege-cart")!), [{ productId: BACKEND_ID, quantity: 1 }]);
});

test("checkout cannot be submitted when the legal requirements could not be loaded", async () => {
  const { ctx, calls } = loadStorefront({ fetch: (url: string) => (url === "/api/products" ? jsonResponse(200, { products: apiProducts }) : jsonResponse(503, { code: "LEGAL_DOCUMENTS_UNAVAILABLE" })), cart: [{ productId: BACKEND_ID, quantity: 1 }] });
  await ctx.loadCatalog();
  assert.equal(await ctx.loadLegalRequirements(), null);
  const checkout = checkoutForm();
  await ctx.submitOrder(checkout.event);
  assert.equal(calls.filter((c) => c.url === "/api/orders").length, 0);
  assert.match(checkout.result.textContent, /Yasal metinler yüklenemedi/);
});

test("the order request carries the ticked legal version ids, sorted as the server listed them", async () => {
  const { ctx, calls } = loadStorefront({ fetch: catalogFetch(() => jsonResponse(201, { ok: true, orderNumber: "ETS-1" })), cart: [{ productId: BACKEND_ID, quantity: 1 }] });
  await ctx.loadCatalog();
  await ctx.loadLegalRequirements();
  await ctx.submitOrder(checkoutForm().event);
  const body = JSON.parse(calls.find((c) => c.url === "/api/orders")!.body);
  assert.deepEqual(body.legalAcceptances, ["ver-ds-1", "ver-pi-1"]);
  assert.ok(body.legalAcceptances.every((id: string) => typeof id === "string" && id.length > 0 && id.length <= 100));
  for (const forbidden of ["acceptedAt", "accepted_at", "accepted"]) assert.equal(forbidden in body, false, "the client never sends a timestamp or a bare accepted flag");
});

test("a legal version mismatch releases the attempt key and reloads the requirements", async () => {
  const { ctx, sessionStorage, calls } = loadStorefront({ fetch: catalogFetch(() => jsonResponse(409, { error: "güncellendi", code: "LEGAL_VERSION_MISMATCH" })), cart: [{ productId: BACKEND_ID, quantity: 1 }] });
  await ctx.loadCatalog();
  await ctx.loadLegalRequirements();
  await ctx.submitOrder(checkoutForm().event);
  assert.equal(sessionStorage.getItem("ege-order-attempt"), null, "a corrected request must not reuse the rejected key");
  assert.equal(calls.filter((c) => c.url === "/api/legal/required").length, 2, "requirements are reloaded after a mismatch");
});

test("legalConsentsComplete requires every server-listed version to be ticked", () => {
  const { ctx } = loadStorefront();
  assert.equal(ctx.legalConsentsComplete(legalDocuments, ["ver-ds-1", "ver-pi-1"]), true);
  assert.equal(ctx.legalConsentsComplete(legalDocuments, ["ver-ds-1"]), false);
  assert.equal(ctx.legalConsentsComplete(null, []), false);
  assert.equal(ctx.legalConsentsComplete([], []), false);
});
