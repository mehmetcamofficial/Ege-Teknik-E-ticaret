import assert from "node:assert/strict";
import test from "node:test";
import { apiProduct, loadStorefront } from "./support/storefront-sandbox.ts";

const pending = { delivery: { status: "pending" }, installation: { status: "pending" } };
const okOrder = () => Promise.resolve({ ok: true, status: 201, json: async () => ({ ok: true, orderNumber: "ETS-TEST-000001" }) });
const cart = { "ege-cart": [{ productId: "synthetic-product-1", quantity: 2 }] };

function form(opts: { installation?: string; marketing?: Record<string, boolean> } = {}) {
  const button = { disabled: false, textContent: "" };
  const result = { textContent: "", innerHTML: "" };
  const marketing = ["sms", "email", "whatsapp"].map((c) => ({ checked: Boolean(opts.marketing?.[c]), dataset: { marketingChannel: c } }));
  const f = {
    fields: { customerName: "Ada", phone: "05001112233", email: "a@b.test", city: "İzmir", address: "Sokak No 1", provider: "discovery", installation: opts.installation ?? "delivery_only" },
    querySelectorAll: (s: string) => (s === "[data-legal-version]" ? [{ checked: true, dataset: { legalVersion: "ver-ds-1" } }] : s === "[data-marketing-channel]" ? marketing : []),
    querySelector: (s: string) => (s === "button.primary" ? button : s === "[data-order-result]" ? result : s === "[name=installation]" ? { value: opts.installation ?? "delivery_only" } : null),
  };
  return { f, button, result };
}
async function prepared(api: Record<string, unknown> = {}) {
  const store = loadStorefront({ storage: cart, api: { products: [apiProduct()], order: okOrder, ...api } });
  await store.fn<() => Promise<void>>("loadCatalog")();
  await store.fn<() => Promise<unknown>>("loadLegalRequirements")();
  await store.fn<() => Promise<void>>("loadCheckoutCharges")();
  return store;
}
const submit = (store: Awaited<ReturnType<typeof prepared>>, f: unknown) => store.fn<(e: unknown) => Promise<void>>("submitOrder")({ preventDefault: () => {}, currentTarget: f });

test("with an unknown mandatory shipping charge the client sends NO order request and explains why", async () => {
  const store = await prepared({ charges: pending });
  const { f, result } = form();
  await submit(store, f);
  assert.equal(store.orderBodies.length, 0);
  assert.match(result.textContent, /teslimat bedeli henüz belirlenmedi/);
});
test("with a known delivery charge but unknown installation charge, installation blocks and no-installation proceeds", async () => {
  const charges = { delivery: { status: "configured", amount: 500, vatRateBps: 2000 }, installation: { status: "pending" } };
  const store = await prepared({ charges });
  const blocked = form({ installation: "survey_then_install" });
  await submit(store, blocked.f);
  assert.equal(store.orderBodies.length, 0);
  assert.match(blocked.result.textContent, /kurulum bedeli henüz belirlenmedi/);
  await submit(store, form({ installation: "delivery_only" }).f);
  assert.equal(store.orderBodies.length, 1);
});
test("when the charge list cannot be loaded the order is not sent", async () => {
  const store = loadStorefront({ storage: cart, api: { products: [apiProduct()], order: okOrder } });
  await store.fn<() => Promise<void>>("loadCatalog")();
  await store.fn<() => Promise<unknown>>("loadLegalRequirements")();
  const { f, result } = form();
  await submit(store, f);
  assert.equal(store.orderBodies.length, 0);
  assert.match(result.textContent, /yüklenemedi/);
});
test("the request carries the displayed final total (products + delivery) but no client price fields", async () => {
  const store = await prepared();
  await submit(store, form().f);
  const body = JSON.parse(store.orderBodies[0]);
  assert.equal(body.expectedTotal, 12_345 * 2 + 500);
  for (const key of ["price", "shipping", "shippingTotal", "installationAmount", "tax", "vatTotal", "subtotal", "total"]) assert.equal(key in body, false, key);
  assert.deepEqual(body.items, [{ productId: "synthetic-product-1", quantity: 2 }]);
  assert.equal(body.installation, "delivery_only");
});
test("choosing installation adds its known charge to the displayed total", async () => {
  const store = await prepared();
  await submit(store, form({ installation: "survey_then_install" }).f);
  assert.equal(JSON.parse(store.orderBodies[0]).expectedTotal, 12_345 * 2 + 500 + 1000);
});
test("marketing: all unchecked still purchases; one or several channels are sent explicitly", async () => {
  const none = await prepared();
  await submit(none, form().f);
  assert.deepEqual(JSON.parse(none.orderBodies[0]).marketing, { sms: false, email: false, whatsapp: false });
  const one = await prepared();
  await submit(one, form({ marketing: { email: true } }).f);
  assert.deepEqual(JSON.parse(one.orderBodies[0]).marketing, { sms: false, email: true, whatsapp: false });
  const many = await prepared();
  await submit(many, form({ marketing: { sms: true, email: true, whatsapp: true } }).f);
  assert.deepEqual(JSON.parse(many.orderBodies[0]).marketing, { sms: true, email: true, whatsapp: true });
});
test("a PRICE_CHANGED refusal reloads the charges and keeps the cart", async () => {
  const store = await prepared({ order: () => Promise.resolve({ ok: false, status: 409, json: async () => ({ code: "PRICE_CHANGED", error: "Sipariş tutarı güncellendi", total: 1 }) }) });
  const { f, result, button } = form();
  await submit(store, f);
  assert.match(result.textContent, /güncellendi/);
  assert.equal(button.disabled, false);
  assert.equal(store.fetchCalls.filter((u) => u === "/api/checkout/charges").length, 2);
});
test("the KVKK notice reuses the exact-version link builder", () => {
  const href = loadStorefront().fn<(d: { slug: string; versionId: string }) => string>("legalVersionHref")({ slug: "kvkk", versionId: "v-1" });
  assert.equal(href, "/legal/kvkk?version=v-1");
});
