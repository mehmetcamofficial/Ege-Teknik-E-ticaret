import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CONFIGURED_SHIPPING, DEFAULT_CHARGES, LIVE_HANDLER_ATTR, apiProduct, confirmationBox, fakeElement, loadStorefront } from "./support/storefront-sandbox.ts";

/**
 * Phase 3.4B: the storefront checkout shows the delivery model; the SERVER stays authoritative (tests/delivery.test.ts).
 * Here we pin what the browser code does: what it displays, what it refuses to send, and what it sends.
 */
const okOrder = () => Promise.resolve({ ok: true, status: 201, json: async () => ({ ok: true, orderNumber: "ETS-TEST-000001" }) });
const AC = () => apiProduct(); // installed_delivery
const PART = (over: Record<string, unknown> = {}) => apiProduct({ id: "synthetic-part-1", name: "Sentetik Filtre", sku: "SKU-PART-1", category: "Yedek Parça", capacity: "", price: 750, deliveryClass: "shippable", ...over });
const cart = { "ege-cart": [{ productId: "synthetic-product-1", quantity: 2 }] };
const partsCart = { "ege-cart": [{ productId: "synthetic-part-1", quantity: 2 }] };
const mixedCart = { "ege-cart": [{ productId: "synthetic-product-1", quantity: 1 }, { productId: "synthetic-part-1", quantity: 2 }] };

function form(opts: { city?: string; district?: string; address?: string; delivery?: string; marketing?: Record<string, boolean> } = {}) {
  const button = { disabled: false, textContent: "" };
  const result = { textContent: "", innerHTML: "" };
  const marketing = ["sms", "email", "whatsapp"].map((c) => ({ checked: Boolean(opts.marketing?.[c]), dataset: { marketingChannel: c } }));
  const f = {
    fields: { customerName: "Ada", phone: "05001112233", email: "a@b.test", city: opts.city ?? "İzmir", district: opts.district ?? "Bornova", address: opts.address ?? "Sokak No 1", delivery: opts.delivery ?? "", provider: "discovery" },
    querySelectorAll: (s: string) => (s === "[data-legal-version]" ? [{ checked: true, dataset: { legalVersion: "ver-ds-1" } }] : s === "[data-marketing-channel]" ? marketing : []),
    querySelector: (s: string) => (s === "button.primary" ? button : s === "[data-order-result]" ? result : null),
  };
  return { f, button, result };
}
async function prepared(api: Record<string, unknown> = {}, storage: Record<string, unknown> = cart) {
  const store = loadStorefront({ storage, api: { products: [AC(), PART()], order: okOrder, ...api } });
  await store.fn<() => Promise<void>>("loadCatalog")();
  await store.fn<() => Promise<unknown>>("loadLegalRequirements")();
  await store.fn<() => Promise<void>>("loadCheckoutCharges")();
  return store;
}
const submit = (store: Awaited<ReturnType<typeof prepared>>, f: unknown) => store.fn<(e: unknown) => Promise<void>>("submitOrder")({ preventDefault: () => {}, currentTarget: f });
const body = (store: Awaited<ReturnType<typeof prepared>>) => JSON.parse(store.orderBodies[0]);

// ---- air conditioner (installed_delivery) --------------------------------------------------------------
test("an air-conditioner order is dealer delivery to an Ege province: no shipping, no pickup, no installation field, no client prices", async () => {
  const store = await prepared({ charges: CONFIGURED_SHIPPING });
  await submit(store, form({ delivery: "shipping" }).f);
  const b = body(store);
  assert.equal(b.delivery, "dealer", "a shipping/pickup value in the form is ignored for a dealer-delivered cart");
  assert.equal(b.city, "İzmir");
  assert.equal(b.district, "Bornova");
  assert.equal(b.expectedTotal, 12_345 * 2, "the price already includes delivery and standard installation: nothing is added, not even a configured shipping fee");
  for (const key of ["installation", "price", "shipping", "shippingFee", "shippingTotal", "installationAmount", "tax", "vatTotal", "subtotal", "total"]) assert.equal(key in b, false, key);
  assert.deepEqual(b.items, [{ productId: "synthetic-product-1", quantity: 2 }]);
});
test("an air conditioner outside the Ege Teknik service area sends NO order request and shows the service-area message", async () => {
  const store = await prepared();
  const { f, result } = form({ city: "Ankara" });
  await submit(store, f);
  assert.equal(store.orderBodies.length, 0);
  assert.equal(result.textContent, "Bu ürün için şu anda Ege Teknik hizmet bölgesi içinde teslimat ve kurulum hizmeti sunuyoruz.");
});
test("an air conditioner without a province sends no request and asks for one", async () => {
  const store = await prepared();
  const { f, result } = form({ city: "" });
  await submit(store, f);
  assert.equal(store.orderBodies.length, 0);
  assert.match(result.textContent, /ilini seçin/);
});
test("an air conditioner without a district sends no request and asks for one; so does a district of another province", async () => {
  for (const district of ["", "Bodrum", "Yok Ilçe"]) {
    const store = await prepared();
    const { f, result } = form({ city: "İzmir", district });
    await submit(store, f);
    assert.equal(store.orderBodies.length, 0, `"${district}"`);
    assert.match(result.textContent, /ilçesini seçin/);
  }
  const ok = await prepared();
  await submit(ok, form({ city: "Muğla", district: "Bodrum" }).f);
  assert.equal(ok.orderBodies.length, 1, "Bodrum is a district of Muğla");
});
test("every service-area province is accepted with one of its own districts, and the lists come from the API (none in store.js)", async () => {
  assert.equal(DEFAULT_CHARGES.serviceProvinces.length, 9);
  for (const province of DEFAULT_CHARGES.serviceProvinces) {
    const store = await prepared();
    await submit(store, form({ city: province, district: DEFAULT_CHARGES.locations[province][0] }).f);
    assert.equal(store.orderBodies.length, 1, province);
  }
  const js = readFileSync("public/store.js", "utf8");
  const logic = js.slice(js.indexOf("let checkoutConfig"), js.indexOf("function renderChargeSummary"));
  for (const name of ["İzmir", "Aydın", "Muğla", "Denizli", "Manisa", "Balıkesir", "Bornova", "Bodrum"]) assert.equal(logic.includes(`'${name}'`) || logic.includes(`"${name}"`), false, `${name} must not be hard-coded in the checkout logic`);
});

// ---- mixed cart -----------------------------------------------------------------------------------------
test("an air conditioner with parts is ONE dealer delivery: no separate shipping, whatever the form or the tariff says", async () => {
  const store = await prepared({ charges: CONFIGURED_SHIPPING }, mixedCart);
  await submit(store, form({ delivery: "shipping" }).f);
  const b = body(store);
  assert.equal(b.delivery, "dealer");
  assert.equal(b.expectedTotal, 12_345 + 750 * 2);
  const outside = await prepared({}, mixedCart);
  const { f, result } = form({ city: "Bursa" });
  await submit(outside, f);
  assert.equal(outside.orderBodies.length, 0, "a mixed cart is bound to the Ege service area");
  assert.match(result.textContent, /Ege Teknik hizmet bölgesi içinde teslimat/);
});

// ---- parts only -----------------------------------------------------------------------------------------
test("parts only: store pickup is the default, free, and needs no address or province", async () => {
  const s = await prepared({}, partsCart);
  await submit(s, form({ city: "", district: "", address: "" }).f);
  const b = body(s);
  assert.equal(b.delivery, "pickup");
  assert.equal(b.expectedTotal, 750 * 2);
  assert.equal(b.city, "");
  assert.equal(b.address, "");
});
test("parts only with the shipping tariff still pending: shipping cannot be chosen, the order goes as pickup (never as shipping)", async () => {
  const store = await prepared({ charges: DEFAULT_CHARGES }, partsCart);
  await submit(store, form({ delivery: "shipping", city: "Ankara", district: "Çankaya", address: "Sokak No 1 Daire 2" }).f);
  assert.equal(body(store).delivery, "pickup");
  assert.equal(body(store).expectedTotal, 750 * 2);
});
test("parts only with a configured tariff: shipping adds the server-published fee, and a province is then required", async () => {
  const store = await prepared({ charges: CONFIGURED_SHIPPING }, partsCart);
  await submit(store, form({ delivery: "shipping", city: "Ankara", district: "Çankaya", address: "Sokak No 1 Daire 2" }).f);
  assert.equal(body(store).delivery, "shipping");
  assert.equal(body(store).expectedTotal, 750 * 2 + 600);
  const noProvince = await prepared({ charges: CONFIGURED_SHIPPING }, partsCart);
  const { f, result } = form({ delivery: "shipping", city: "" });
  await submit(noProvince, f);
  assert.equal(noProvince.orderBodies.length, 0);
  assert.match(result.textContent, /ilini seçin/);
  const noDistrict = await prepared({ charges: CONFIGURED_SHIPPING }, partsCart);
  const second = form({ delivery: "shipping", city: "Ankara", district: "" });
  await submit(noDistrict, second.f);
  assert.equal(noDistrict.orderBodies.length, 0, "shipping needs a district too");
  assert.match(second.result.textContent, /ilçesini seçin/);
});

// ---- fail-closed ----------------------------------------------------------------------------------------
test("when the checkout config cannot be loaded, or is malformed, no order is sent", async () => {
  const unloaded = loadStorefront({ storage: cart, api: { products: [AC()], order: okOrder, charges: { nope: true } } });
  await unloaded.fn<() => Promise<void>>("loadCatalog")();
  await unloaded.fn<() => Promise<unknown>>("loadLegalRequirements")();
  await unloaded.fn<() => Promise<void>>("loadCheckoutCharges")();
  const { f, result } = form();
  await submit(unloaded, f);
  assert.equal(unloaded.orderBodies.length, 0);
  assert.match(result.textContent, /yüklenemedi/);
});
test("a product whose delivery class is missing or unknown blocks the order instead of being guessed", async () => {
  for (const deliveryClass of [undefined, "", "klima", "SHIPPABLE"]) {
    const store = await prepared({ products: [apiProduct({ deliveryClass })] });
    const { f, result } = form();
    await submit(store, f);
    assert.equal(store.orderBodies.length, 0, String(deliveryClass));
    assert.match(result.textContent, /teslimat bilgisi doğrulanamadı/);
  }
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
test("a PRICE_CHANGED refusal reloads the config and keeps the cart", async () => {
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

// ---- what the page shows -------------------------------------------------------------------------------
const checkoutHtml = readFileSync("public/checkout.html", "utf8");
const storeJs = readFileSync("public/store.js", "utf8");
function checkoutPage(opts: { cart?: unknown[]; charges?: Record<string, unknown>; products?: Record<string, unknown>[]; city?: string; district?: string; delivery?: string } = {}) {
  const submitButton = { disabled: /data-submit-order disabled/.test(checkoutHtml), textContent: "" }; // starts exactly as the shipped HTML does
  const elements = { "[data-submit-order]": submitButton, "[data-cart-items]": fakeElement(), "[data-subtotal]": fakeElement(), "[data-vat]": fakeElement(), "[data-charge-summary]": fakeElement(), "[data-total]": fakeElement(), "[data-charge-notice]": { ...fakeElement(), hidden: true }, "[data-delivery-options]": fakeElement(), "[name=city]": { value: opts.city ?? "İzmir" }, "[name=district]": { value: opts.district ?? "Bornova", required: false }, "[data-district]": { ...fakeElement(), disabled: true, value: "" }, "[data-province]": { ...fakeElement(), value: opts.city ?? "İzmir" }, "[name=address]": { value: "" }, "[name=delivery]:checked": opts.delivery ? { value: opts.delivery } : null, "[data-address-hint]": fakeElement() } as unknown as Record<string, ReturnType<typeof fakeElement>>;
  const store = loadStorefront({ path: "checkout.html", elements, storage: { "ege-cart": opts.cart ?? [{ productId: "synthetic-product-1", quantity: 1 }] }, api: { products: opts.products ?? [AC(), PART()], charges: opts.charges } });
  return { store, submitButton, elements };
}
const ready = async (opts: Parameters<typeof checkoutPage>[0] = {}) => { const page = checkoutPage(opts); await page.store.fn<() => Promise<void>>("loadCatalog")(); await page.store.fn<() => Promise<void>>("loadCheckoutCharges")(); return page; };

test("checkout ships the confirmation button disabled in the HTML itself, not only after JavaScript runs", () => {
  assert.match(checkoutHtml, /<button class="primary" data-submit-order disabled[^>]*>Siparişi Onayla — ödeme yükümlülüğü doğurur<\/button>/);
});
test("before the checkout config is available the confirmation stays disabled (catalog loading, then catalog ready without config)", async () => {
  const { store, submitButton } = checkoutPage();
  store.fn<() => void>("renderChargeSummary")();
  assert.equal(submitButton.disabled, true, "catalog not yet authoritative");
  await store.fn<() => Promise<void>>("loadCatalog")();
  store.fn<() => void>("renderChargeSummary")();
  assert.equal(submitButton.disabled, true, "catalog ready, config not loaded");
});
test("a malformed config keeps the confirmation disabled", async () => {
  for (const charges of [{}, { shipping: { status: "pending" } }, { shipping: { status: "pending" }, provinces: [], egeProvinces: [] }]) {
    const { submitButton } = await ready({ charges });
    assert.equal(submitButton.disabled, true, JSON.stringify(charges));
  }
});
test("the confirmation is enabled only with an authoritative catalog, a loaded config, items and a valid delivery choice", async () => {
  assert.equal((await ready()).submitButton.disabled, false);
  assert.equal((await ready({ cart: [] })).submitButton.disabled, true, "empty cart");
  assert.equal((await ready({ city: "" })).submitButton.disabled, true, "air conditioner without a province");
  assert.equal((await ready({ city: "Ankara" })).submitButton.disabled, true, "air conditioner outside the service area");
  assert.equal((await ready({ district: "" })).submitButton.disabled, true, "air conditioner without a district");
  assert.equal((await ready({ cart: [{ productId: "synthetic-part-1", quantity: 1 }], city: "" })).submitButton.disabled, false, "parts pickup needs no province");
  assert.match(storeJs, /if\(submit\)submit\.disabled=summary\.total===null\|\|!hasItems\}/, "the only enabling path is the delivery summary");
});
test("air-conditioner checkout: 'Standart montaj dahil', service-area delivery and service routing are shown, and there is no shipping or pickup choice", async () => {
  const { elements } = await ready();
  const html = elements["[data-delivery-options]"].innerHTML;
  assert.match(html, /Standart montaj dahil/);
  assert.match(html, /Ege Teknik hizmet bölgesinde adrese teslim/);
  assert.doesNotMatch(html, /Ege Bölgesi/, "the service area is not called the geographic region");
  assert.match(html, /Yetkili servis yönlendirmesi/);
  assert.doesNotMatch(html, /type="radio"|name="delivery"|Kargo|Mağazadan teslim/, "no delivery choice is offered for an air conditioner");
  assert.doesNotMatch(html, /[Üü]cretsiz (kargo|montaj)|[Bb]edava/, "delivery included in the price is not called free shipping or free installation");
  assert.match(elements["[data-charge-summary]"].innerHTML, /Adrese teslim/);
  assert.match(elements["[data-charge-summary]"].innerHTML, /Standart montaj/);
  assert.match(elements["[data-charge-summary]"].innerHTML, /İzmir \/ Bornova/);
});
test("a mixed cart says the parts come with the same delivery", async () => {
  const { elements } = await ready({ cart: [{ productId: "synthetic-product-1", quantity: 1 }, { productId: "synthetic-part-1", quantity: 1 }], charges: CONFIGURED_SHIPPING });
  const html = elements["[data-delivery-options]"].innerHTML;
  assert.match(html, /yedek parçalar aynı teslimatla gelir/);
  assert.doesNotMatch(html, /type="radio"/);
});
test("parts-only checkout: pickup is preselected and free; shipping is disabled with the 'coming soon' message while the tariff is pending", async () => {
  const { elements, submitButton } = await ready({ cart: [{ productId: "synthetic-part-1", quantity: 1 }] });
  const html = elements["[data-delivery-options]"].innerHTML;
  assert.match(html, /<input type="radio" name="delivery" value="pickup" checked>/);
  assert.match(html, /value="shipping"[^>]*disabled/);
  assert.match(html, /Kargo seçeneği yakında aktif olacaktır\. Şimdilik mağazadan teslim alabilirsiniz\./);
  assert.match(elements["[data-charge-summary]"].innerHTML, /Mağazadan teslim · Ücretsiz/);
  assert.equal(submitButton.disabled, false, "pickup keeps working while shipping is pending");
});
test("parts-only checkout with a configured tariff shows the server fee and enables the shipping radio", async () => {
  const { elements } = await ready({ cart: [{ productId: "synthetic-part-1", quantity: 1 }], charges: CONFIGURED_SHIPPING });
  const html = elements["[data-delivery-options]"].innerHTML;
  assert.doesNotMatch(html, /value="shipping"[^>]*disabled/);
  assert.match(html, /₺600/);
  const chosen = await ready({ cart: [{ productId: "synthetic-part-1", quantity: 1 }], charges: CONFIGURED_SHIPPING, delivery: "shipping" });
  assert.match(chosen.elements["[data-charge-summary]"].innerHTML, /Kargo ücreti/);
  assert.match(chosen.elements["[data-charge-summary]"].innerHTML, /₺600/);
  assert.equal(chosen.elements["[data-total]"].textContent, "₺1.350");
});
test("the province, district and address become required for dealer delivery and shipping, never for pickup", async () => {
  const dealer = await ready();
  assert.equal((dealer.elements["[name=city]"] as unknown as { required: boolean }).required, true);
  assert.equal((dealer.elements["[name=district]"] as unknown as { required: boolean }).required, true);
  assert.equal((dealer.elements["[name=address]"] as unknown as { required: boolean }).required, true);
  const pickup = await ready({ cart: [{ productId: "synthetic-part-1", quantity: 1 }] });
  assert.equal((pickup.elements["[name=city]"] as unknown as { required: boolean }).required, false);
  assert.equal((pickup.elements["[name=district]"] as unknown as { required: boolean }).required, false);
  assert.equal((pickup.elements["[name=address]"] as unknown as { required: boolean }).required, false);
});

test("no legal or marketing checkbox is ever preselected", () => {
  const boxes = [...checkoutHtml.matchAll(/<input type="checkbox"[^>]*>/g), ...storeJs.matchAll(/<input type="checkbox"[^>]*>/g)].map((m) => m[0]);
  assert.ok(boxes.length >= 4);
  for (const box of boxes) assert.doesNotMatch(box, /\bchecked\b/, box);
  assert.equal((checkoutHtml.match(/data-marketing-channel="(sms|email|whatsapp)"/g) ?? []).length, 3);
});

// ---- unit price and VAT are shown, not just a line total ------------------------------------------
test("the cart summary shows each line's unit price alongside quantity, and a VAT row derived from vatRateBps", async () => {
  const elements = { "[data-cart-items]": fakeElement(), "[data-subtotal]": fakeElement(), "[data-vat]": fakeElement(), "[data-charge-summary]": fakeElement(), "[data-total]": fakeElement(), "[data-charge-notice]": { ...fakeElement(), hidden: true } } as unknown as Record<string, ReturnType<typeof fakeElement>>;
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
    subtotal: 20_575, vatTotal: 4_115, shippingTotal: 0, installationTotal: 0, total: 24_690,
    delivery: { name: "Ada Lovelace", phone: "05001112233", email: "ada@example.test", city: "İzmir", district: "Bornova", address: "Kuşadası Mahallesi 1 Sokak No 1", installation: "included_standard", method: "dealer" },
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
  assert.equal(box.children["[data-confirmation-total]"].textContent, "₺24.690");
  assert.equal(box.children["[data-confirmation-shipping]"].textContent, "Adrese teslim · Standart montaj dahil");
  assert.match(box.children["[data-confirmation-delivery]"].innerHTML, /Bornova \/ İzmir/);
  assert.equal(box.children["[data-confirmation-vat]"].textContent, "₺4.115");
  assert.match(box.children["[data-confirmation-delivery]"].innerHTML, /Ada Lovelace/);
  assert.match(box.children["[data-confirmation-delivery]"].innerHTML, /Kuşadası Mahallesi/);
});

test("the confirmation states the delivery method from the server's answer, with a safe fallback for legacy orders", async () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ delivery: { ...confirmationResponse().delivery, method: "dealer", installation: "included_standard" } }, /^Adrese teslim · Standart montaj dahil$/],
    [{ delivery: { ...confirmationResponse().delivery, method: "dealer", installation: "none" } }, /^Adrese teslim$/],
    [{ delivery: { ...confirmationResponse().delivery, method: "pickup", installation: "none" } }, /^Mağazadan teslim · Ücretsiz$/],
    [{ shippingTotal: 600, delivery: { ...confirmationResponse().delivery, method: "shipping", installation: "none" } }, /^Kargo · ₺600$/],
    [{ shippingTotal: 500, delivery: { ...confirmationResponse().delivery, method: "", installation: "delivery_only" } }, /^₺500$/],
  ];
  for (const [override, expected] of cases) {
    const box = confirmationBox();
    const { f } = form();
    const store = loadStorefront({ storage: cart, elements: { "[data-order-confirmation]": box, "[data-checkout-form]": { ...fakeElement(), hidden: false } }, api: { products: [AC()], order: () => Promise.resolve({ ok: true, status: 201, json: async () => confirmationResponse(override) }) } });
    await store.fn<() => Promise<void>>("loadCatalog")();
    await store.fn<() => Promise<unknown>>("loadLegalRequirements")();
    await store.fn<() => Promise<void>>("loadCheckoutCharges")();
    await submit(store, f);
    assert.match(box.children["[data-confirmation-shipping]"].textContent, expected);
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
