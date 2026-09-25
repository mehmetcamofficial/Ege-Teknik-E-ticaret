import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LIVE_HANDLER_ATTR, apiProduct, confirmationBox, fakeElement, loadStorefront } from "./support/storefront-sandbox.ts";

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

// ---- fail-closed confirmation button ---------------------------------------------------------------------
const checkoutHtml = readFileSync("public/checkout.html", "utf8");
const storeJs = readFileSync("public/store.js", "utf8");
function checkoutPage(opts: { cart?: unknown[]; charges?: Record<string, unknown> } = {}) {
  const submitButton = { disabled: /data-submit-order disabled/.test(checkoutHtml), textContent: "" }; // starts exactly as the shipped HTML does
  const elements = { "[data-submit-order]": submitButton, "[data-cart-items]": fakeElement(), "[data-subtotal]": fakeElement(), "[data-charge-summary]": fakeElement(), "[data-total]": fakeElement(), "[data-charge-notice]": { ...fakeElement(), hidden: true }, "[data-installation]": { value: "delivery_only" } } as unknown as Record<string, ReturnType<typeof fakeElement>>;
  const store = loadStorefront({ path: "checkout.html", elements, storage: { "ege-cart": opts.cart ?? [{ productId: "synthetic-product-1", quantity: 1 }] }, api: { products: [apiProduct()], charges: opts.charges } });
  return { store, submitButton };
}

test("checkout ships the confirmation button disabled in the HTML itself, not only after JavaScript runs", () => {
  assert.match(checkoutHtml, /<button class="primary" data-submit-order disabled[^>]*>Siparişi Onayla — ödeme yükümlülüğü doğurur<\/button>/);
});

test("before charge data is available the confirmation stays disabled (catalog loading, then catalog ready without tariffs)", async () => {
  const { store, submitButton } = checkoutPage();
  store.fn<() => void>("renderChargeSummary")();
  assert.equal(submitButton.disabled, true, "catalog not yet authoritative");
  await store.fn<() => Promise<void>>("loadCatalog")();
  store.fn<() => void>("renderChargeSummary")();
  assert.equal(submitButton.disabled, true, "catalog ready, charges not loaded");
});

test("pending or unknown charges keep the confirmation disabled", async () => {
  for (const charges of [pending, { delivery: { status: "pending" }, installation: { status: "configured", amount: 1000, vatRateBps: 2000 } }]) {
    const { store, submitButton } = checkoutPage({ charges });
    await store.fn<() => Promise<void>>("loadCatalog")();
    await store.fn<() => Promise<void>>("loadCheckoutCharges")();
    assert.equal(submitButton.disabled, true, JSON.stringify(charges));
  }
});

test("existing client logic enables it only once the catalog is authoritative, charges are known and the cart has items", async () => {
  const known = { delivery: { status: "configured", amount: 500, vatRateBps: 2000 }, installation: { status: "configured", amount: 1000, vatRateBps: 2000 } };
  const ready = checkoutPage({ charges: known });
  await ready.store.fn<() => Promise<void>>("loadCheckoutCharges")();
  assert.equal(ready.submitButton.disabled, true, "charges known but catalog not yet authoritative");
  await ready.store.fn<() => Promise<void>>("loadCatalog")();
  assert.equal(ready.submitButton.disabled, false);
  const empty = checkoutPage({ charges: known, cart: [] });
  await empty.store.fn<() => Promise<void>>("loadCatalog")();
  await empty.store.fn<() => Promise<void>>("loadCheckoutCharges")();
  assert.equal(empty.submitButton.disabled, true, "empty cart");
  assert.match(storeJs, /if\(submit\)submit\.disabled=summary\.total===null\|\|!hasItems\}/, "the only enabling path is the charge summary");
});

test("no legal or marketing checkbox is ever preselected", () => {
  const boxes = [...checkoutHtml.matchAll(/<input type="checkbox"[^>]*>/g), ...storeJs.matchAll(/<input type="checkbox"[^>]*>/g)].map((m) => m[0]);
  assert.ok(boxes.length >= 4);
  for (const box of boxes) assert.doesNotMatch(box, /\bchecked\b/, box);
  assert.equal((checkoutHtml.match(/data-marketing-channel="(sms|email|whatsapp)"/g) ?? []).length, 3);
});

// ---- unit price and VAT are shown, not just a line total ------------------------------------------
test("the cart summary shows each line's unit price alongside quantity, and a VAT row derived from vatRateBps", async () => {
  const elements = { "[data-cart-items]": fakeElement(), "[data-subtotal]": fakeElement(), "[data-vat]": fakeElement(), "[data-charge-summary]": fakeElement(), "[data-total]": fakeElement(), "[data-charge-notice]": { ...fakeElement(), hidden: true }, "[data-installation]": { value: "delivery_only" } } as unknown as Record<string, ReturnType<typeof fakeElement>>;
  const store = loadStorefront({ path: "checkout.html", elements, storage: cart, api: { products: [apiProduct({ price: 12_345, vatRateBps: 2_000 })] } });
  await store.fn<() => Promise<void>>("loadCatalog")();
  store.fn<() => void>("renderCheckout")();
  const items = elements["[data-cart-items]"];
  assert.match(items.innerHTML, /₺12\.345 × 2 adet/, "unit price and quantity are both shown");
  // VAT is carved out of the VAT-inclusive line total, mirroring lib/order-domain.ts's calculateLine.
  const expectedVat = Math.round(12_345 * 2 * 2_000 / 12_000);
  assert.equal(elements["[data-vat]"].textContent, new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(expectedVat));
});

// ---- guest order confirmation ----------------------------------------------------------------------
const HOSTILE = `"><img src=x onerror=alert(1)><script>alert(2)</script>'`;
function assertInertHtml(html: string, where: string) {
  assert.doesNotMatch(html, /<script/i, `${where}: live <script>`);
  assert.doesNotMatch(html, /<img src=x/i, `${where}: injected <img>`);
  const outsideQuotedValues = html.replace(/"[^"]*"/g, '""');
  assert.equal(outsideQuotedValues.match(LIVE_HANDLER_ATTR), null, `${where}: live event-handler attribute`);
}
function confirmationResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true, orderNumber: "ETS-20260101-ABC123", status: "pending_payment",
    items: [{ productName: "Airy 12000", quantity: 2, unitPrice: 12_345, lineTotal: 24_690 }],
    subtotal: 20_575, vatTotal: 4_115, shippingTotal: 500, installationTotal: 0, total: 25_190,
    delivery: { name: "Ada Lovelace", phone: "05001112233", email: "ada@example.test", city: "İzmir", address: "Kuşadası Mahallesi 1 Sokak No 1", installation: "delivery_only" },
    ...overrides,
  };
}
test("a successful order shows real items, totals and delivery details, and hides the form", async () => {
  const box = confirmationBox();
  const { f } = form();
  const store = loadStorefront({ storage: cart, elements: { "[data-order-confirmation]": box, "[data-checkout-form]": { ...fakeElement(), hidden: false } }, api: { products: [apiProduct()], order: () => Promise.resolve({ ok: true, status: 201, json: async () => confirmationResponse() }) } });
  await store.fn<() => Promise<void>>("loadCatalog")();
  await store.fn<() => Promise<unknown>>("loadLegalRequirements")();
  await store.fn<() => Promise<void>>("loadCheckoutCharges")();
  await submit(store, f);
  assert.equal(box.hidden, false);
  assert.match(box.children["[data-confirmation-number]"].innerHTML, /ETS-20260101-ABC123/);
  assert.match(box.children["[data-confirmation-items]"].innerHTML, /Airy 12000/);
  assert.match(box.children["[data-confirmation-items]"].innerHTML, /2 adet/);
  assert.equal(box.children["[data-confirmation-total]"].textContent, "₺25.190");
  assert.equal(box.children["[data-confirmation-vat]"].textContent, "₺4.115");
  assert.match(box.children["[data-confirmation-delivery]"].innerHTML, /Ada Lovelace/);
  assert.match(box.children["[data-confirmation-delivery]"].innerHTML, /Kuşadası Mahallesi/);
});

test("installation row shows only when the customer chose installation, with its real amount", async () => {
  for (const [installation, installationTotal, shouldShow] of [["delivery_only", 0, false], ["survey_then_install", 1_000, true]] as const) {
    const box = confirmationBox();
    const { f } = form();
    const store = loadStorefront({ storage: cart, elements: { "[data-order-confirmation]": box, "[data-checkout-form]": { ...fakeElement(), hidden: false } }, api: { products: [apiProduct()], order: () => Promise.resolve({ ok: true, status: 201, json: async () => confirmationResponse({ installationTotal, delivery: { ...confirmationResponse().delivery, installation } }) }) } });
    await store.fn<() => Promise<void>>("loadCatalog")();
    await store.fn<() => Promise<unknown>>("loadLegalRequirements")();
    await store.fn<() => Promise<void>>("loadCheckoutCharges")();
    await submit(store, f);
    assert.equal(box.hidden, false, installation);
    assert.equal(box.children["[data-confirmation-installation-row]"].hidden, !shouldShow, installation);
    if (shouldShow) assert.equal(box.children["[data-confirmation-installation]"].textContent, "₺1.000");
  }
});

test("hostile product names and delivery details in the server response are shown as inert text, never markup", async () => {
  const box = confirmationBox();
  const { f } = form();
  const store = loadStorefront({
    storage: cart, elements: { "[data-order-confirmation]": box, "[data-checkout-form]": { ...fakeElement(), hidden: false } },
    api: { products: [apiProduct()], order: () => Promise.resolve({ ok: true, status: 201, json: async () => confirmationResponse({ items: [{ productName: HOSTILE, quantity: 1, unitPrice: 1, lineTotal: 1 }], delivery: { ...confirmationResponse().delivery, name: HOSTILE, address: HOSTILE } }) }) },
  });
  await store.fn<() => Promise<void>>("loadCatalog")();
  await store.fn<() => Promise<unknown>>("loadLegalRequirements")();
  await store.fn<() => Promise<void>>("loadCheckoutCharges")();
  await submit(store, f);
  assert.equal(box.hidden, false, "the confirmation must actually have rendered for this test to mean anything");
  assert.notEqual(box.children["[data-confirmation-items]"].innerHTML, "");
  assertInertHtml(box.children["[data-confirmation-items]"].innerHTML, "confirmation items");
  assertInertHtml(box.children["[data-confirmation-delivery]"].innerHTML, "confirmation delivery");
});

test("no online payment was actually taken: the confirmation states this honestly", () => {
  assert.match(checkoutHtml, /data-confirmation-payment-notice/);
  assert.match(checkoutHtml, /Online kartla ödeme henüz aktif değil.*ödeme tahsil edilmedi/);
});
