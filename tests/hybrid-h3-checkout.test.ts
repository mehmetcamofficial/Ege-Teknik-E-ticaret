/**
 * H3 premium cart & checkout: the drawer stays a view over ege-cart/writeCart, explains each line problem,
 * never prints missing-data placeholders and keeps focus inside the modal.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { apiProduct, fakeElement, loadStorefront } from "./support/storefront-sandbox.ts";

const ux = readFileSync("public/store-ux.js", "utf8");
const core = readFileSync("public/store-core.js", "utf8");

test("H3-A drawer is still a view over ege-cart/writeCart, with no second cart store", () => {
  assert.doesNotMatch(ux, /localStorage\.setItem/);
  assert.match(ux, /cartLines\(getCart\(\),getProducts\(\)\)/);
  assert.match(core, /function writeCart\(entries\)\{\n const next=JSON\.stringify\(normalizeCartEntries\(entries,null\)\);[\s\S]{0,160}?localStorage\.setItem\('ege-cart',next\)\}/);
  assert.match(core, /updateCartCount\(\);invalidateLegalPreview\(\);cartDrawer\(\)\?\.refresh\(\);return true/, "every cart write still invalidates the legal preview");
});

test("H3-A each line problem has its own message, and an over-stock line offers a one-tap fix", () => {
  for (const text of ["Bu ürün katalogda bulunamadı", "artık online satışta değil", "Ürün fiyatı doğrulanamadı", "Bu ürün stokta kalmadı", "Stokta ${limit} adet var. Adedi ${limit} veya daha az yapın."]) assert.ok(ux.includes(text), text);
  assert.match(ux, /data-drawer-action="fix" data-cart-id="\$\{id\}">Adedi \$\{limit\} yap<\/button>/);
  assert.match(ux, /else if\(control\.dataset\.drawerAction==='fix'\)\{const p=getProducts\(\)\.find\(x=>x\.id===id\);if\(p&&changeCartQuantity\(id,productQuantityLimit\(p\.stock\)\)\)/);
  assert.match(ux, /role="alert"/);
});

test("H3-A drawer shows counts and VAT, states delivery honestly and never prints placeholders", () => {
  assert.match(ux, /`\$\{lines\.length\} ürün · \$\{units\} adet`/);
  assert.match(ux, /<span>İçindeki KDV<\/span><span data-drawer-vat>—<\/span><span>Teslimat \/ montaj<\/span><span>Sipariş adımında gösterilir<\/span>/);
  assert.match(ux, /vat\.textContent=allValid\?money\(cartVat\(lines\)\):'—'/);
  assert.doesNotMatch(ux, /paylaşılmamış/);
  assert.match(ux, /Sipariş adımına geçmek için yukarıdaki uyarıları düzeltin\./);
});

test("H3-A focus restoration never drops to the page behind the modal", () => {
  assert.match(ux, /restore=body\.contains\(active\)\?\{action:active\.dataset\?\.drawerAction/);
  assert.match(ux, /\[data-drawer-action="quantity"\]'\)\]\.find\(el=>el\.dataset\.cartId===restore\.id/);
});

/* ---------- H3-B checkout ---------- */
const cart = { "ege-cart": [{ productId: "synthetic-product-1", quantity: 1 }] };
function checkoutForm(fields: Record<string, string> = {}, elements = false) {
  const button = { disabled: false, textContent: "" }, result = { textContent: "", innerHTML: "" };
  const values = { customerName: "Ada Yılmaz", phone: "0500 111 22 33", email: "ada@example.test", city: "İzmir", district: "Bornova", address: "Test Mahallesi 1 Sokak No 1", delivery: "", provider: "discovery", ...fields };
  const attrs: Record<string, Record<string, string>> = {};
  const field = (name: string) => ({ name, id: "", value: values[name as keyof typeof values] ?? "", required: true, disabled: false, closest: () => null, parentElement: null,
    getAttribute: (k: string) => attrs[name]?.[k] ?? null, setAttribute: (k: string, v: string) => { (attrs[name] ??= {})[k] = v; }, removeAttribute: (k: string) => { delete attrs[name]?.[k]; } });
  const fieldEls = Object.fromEntries(["customerName", "phone", "email", "city", "district", "address"].map((n) => [n, field(n)]));
  const f = {
    fields: values,
    querySelectorAll: (s: string) => (s === "[data-legal-version]" ? [{ checked: true, dataset: { legalVersion: "ver-ds-1" } }] : []),
    querySelector: (s: string) => (s === "[data-submit-order]" || s === "button.primary" ? button : s === "[data-order-result]" ? result : elements ? (fieldEls[/\[name="(\w+)"\]/.exec(s)?.[1] ?? ""] ?? null) : null),
  };
  return { f, button, result, attrs };
}
async function prepared(order: () => Promise<unknown>) {
  const store = loadStorefront({ storage: cart, api: { products: [apiProduct()], order } });
  await store.fn<() => Promise<void>>("loadCatalog")();
  await store.fn<() => Promise<unknown>>("loadLegalRequirements")();
  await store.fn<() => Promise<void>>("loadCheckoutCharges")();
  return store;
}
const ok = () => Promise.resolve({ ok: true, status: 201, json: async () => ({ ok: true, orderNumber: "ETS-TEST-000001" }) });

test("H3-B a second submit while the first is in flight sends no second order", async () => {
  let release: (v: unknown) => void = () => {};
  const store = await prepared(() => new Promise((r) => { release = r; }));
  const { f, button } = checkoutForm();
  assert.ok(await store.fn<(form: unknown) => Promise<unknown>>("requestLegalPreview")(f));
  const submit = store.fn<(e: unknown) => Promise<void>>("submitOrder");
  const first = submit({ preventDefault: () => {}, currentTarget: f });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, "Sipariş kaydediliyor…");
  await submit({ preventDefault: () => {}, currentTarget: f });
  release({ ok: true, status: 201, json: async () => ({ ok: true, orderNumber: "ETS-TEST-000001" }) });
  await first;
  assert.equal(store.orderBodies.length, 1, "exactly one POST /api/orders");
});

test("H3-B invalid contact fields block the legal preview and the order, with field-level errors", async () => {
  const store = await prepared(ok);
  const { f, attrs, result } = checkoutForm({ customerName: "A", phone: "123", email: "not-an-email" }, true);
  assert.equal(await store.fn<(form: unknown) => Promise<unknown>>("requestLegalPreview")(f), null);
  await store.fn<(e: unknown) => Promise<void>>("submitOrder")({ preventDefault: () => {}, currentTarget: f });
  assert.equal(store.orderBodies.length, 0);
  assert.equal(result.textContent, "Siparişi tamamlamak için işaretli alanları düzeltin.");
  for (const name of ["customerName", "phone", "email"]) { assert.equal(attrs[name]["aria-invalid"], "true", name); assert.equal(attrs[name]["aria-describedby"], `co-${name}-error`, name); }
});

test("H3-B a network failure keeps the cart and explains in Turkish, never the browser's English text", async () => {
  const store = await prepared(() => Promise.reject(Object.assign(new Error("Failed to fetch"), { name: "TypeError" })));
  const { f, button, result } = checkoutForm();
  assert.ok(await store.fn<(form: unknown) => Promise<unknown>>("requestLegalPreview")(f));
  await store.fn<(e: unknown) => Promise<void>>("submitOrder")({ preventDefault: () => {}, currentTarget: f });
  assert.equal(result.textContent, "Bağlantı kurulamadı. Bilgileriniz ve sepetiniz korunuyor; tekrar deneyebilirsiniz.");
  assert.equal(button.textContent, "Tekrar Dene");
  assert.equal(button.disabled, false);
  assert.deepEqual(JSON.parse(JSON.stringify(store.fn<() => unknown>("readCartRaw")())), cart["ege-cart"], "the cart survives a failed order");
});

test("H3-B checkout markup: numbered steps, error summary, honest billing note, phone action bar, no payment provider", () => {
  const html = readFileSync("public/checkout.html", "utf8");
  assert.match(html, /<form class="checkout-grid" data-checkout-form novalidate>/);
  assert.match(html, /<div class="checkout-errors" data-checkout-errors role="alert" tabindex="-1" hidden><\/div>/);
  for (const step of ["İletişim bilgileri", "Teslimat adresi", "Ödeme yöntemi"]) assert.match(html, new RegExp(`class="checkout-step"><span aria-hidden="true">\\d</span>${step}`));
  assert.match(html, /ayrı bir fatura adresi alınmaz/);
  assert.match(html, /data-checkout-bar hidden>/);
  assert.doesNotMatch(html, /PayTR|iyzico|kart numarası/i);
});

/* ---------- H3-C order safety (client side; the server suites are listed in the H3 report) ---------- */
test("H3-C a changed cart gets a fresh order attempt key; an unchanged rewrite keeps it for server dedupe", () => {
  assert.match(core, /if\(changed&&typeof sessionStorage!=='undefined'\)clearOrderAttemptKey\(sessionStorage\);/);
  assert.match(core, /changed=JSON\.stringify\(normalizeCartEntries\(readCartRaw\(\),null\)\)!==next/);
});

test("H3-C refusals are explained and stock conflicts re-read the catalog", () => {
  assert.match(core, /if\(response\.status===409&&!data\.code\|\|data\.code==='PRODUCT_NOT_SELLABLE'\)\{void loadCatalog\(\)\}/);
  assert.match(core, /if\(data\.code==='IDEMPOTENCY_KEY_REUSED'\)throw new Error\('Sipariş bilgileriniz değişti\. Lütfen siparişi yeniden onaylayın\.'\)/);
  assert.match(core, /Sunucuda geçici bir sorun oluştu; sipariş kaydedilmedi\./);
  assert.match(core, /\/\/ Cart and attempt key are cleared only once the server has confirmed the order\.\n    clearOrderAttemptKey\(sessionStorage\);writeCart\(\[\]\);/);
});

test("H3-C a server 5xx keeps the cart and allows a retry", async () => {
  const store = await prepared(() => Promise.resolve({ ok: false, status: 503, json: async () => ({}) }));
  const { f, result } = checkoutForm();
  assert.ok(await store.fn<(form: unknown) => Promise<unknown>>("requestLegalPreview")(f));
  await store.fn<(e: unknown) => Promise<void>>("submitOrder")({ preventDefault: () => {}, currentTarget: f });
  assert.equal(result.textContent, "Sunucuda geçici bir sorun oluştu; sipariş kaydedilmedi. Bilgileriniz ve sepetiniz korunuyor; tekrar deneyebilirsiniz.");
  await store.fn<(e: unknown) => Promise<void>>("submitOrder")({ preventDefault: () => {}, currentTarget: f });
  // The retry reusing one idempotency key is asserted in scripts/test-hybrid-h3.mjs on real request headers.
  assert.equal(store.orderBodies.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(store.fn<() => unknown>("readCartRaw")())), cart["ege-cart"]);
});

/* ---------- H3-D fixes found by the browser acceptance ---------- */
test("H3-D the phone bar only offers 'Siparişi onayla' with a live preview and every document accepted", () => {
  assert.match(core, /function checkoutLegalReady\(form\)\{return !!legalPreview&&legalPreviewAcceptanceIds\(legalPreview,acceptedLegalVersionIds\(form\.querySelectorAll\('\[data-legal-version\]'\)\)\)\.length===legalPreview\.documents\.length\}/);
  assert.match(core, /ready=submit&&!submit\.disabled&&checkoutLegalReady\(form\);/);
  assert.match(core, /if\(submit&&!submit\.disabled&&checkoutLegalReady\(form\)\)\{form\.requestSubmit\(submit\);return\}/);
});

test("H3-D floating help and cookie buttons step aside from checkout errors; legal summaries are 44px targets", () => {
  const css = readFileSync("public/store.css", "utf8");
  assert.match(core, /const HELP_PROTECTED='\[data-order-result\]\.is-error,\[data-checkout-errors\]:not\(\[hidden\]\),\.field-error:not\(\[hidden\]\),/);
  assert.match(core, /cookie\.classList\.toggle\('is-clearing',document\.activeElement!==cookie&&helpCovers\(cookie\)\)/);
  assert.match(css, /\.cookie-settings-trigger\.is-clearing\{opacity:0;visibility:hidden;pointer-events:none\}/);
  assert.match(css, /\.legal-preview details>summary\{min-height:44px;/);
});

test("H3-D retrying while the catalog re-reads says it is updating, not 'refresh the page'", () => {
  assert.match(core, /say\(catalogState==='loading'\?'Ürün bilgileri güncelleniyor; birkaç saniye sonra tekrar deneyin\. Bilgileriniz korunuyor\.':'Ürün bilgileri sunucudan doğrulanamadı\. Lütfen sayfayı yenileyip tekrar deneyin\.'\)/);
});

/* ---------- H3.1-B legal documents: never show placeholders, block on missing/invalid documents ---------- */
const jsonRes = (status: number, body: unknown) => () => Promise.resolve({ ok: status < 400, status, json: async () => body });
const goodDoc = { slug: "distance-sales", title: "TEST SENTETIK — Mesafeli Satış", version: 3, documentVersionId: "ver-ds-1", renderedBody: "TEST gövdesi" };
const preview = (docs: unknown[]) => jsonRes(200, { ok: true, orderNumber: "TEST-ORDER", orderIssuedAt: 1757000000000, expiresAt: 4102444800000, legalPreviewToken: "preview.payload.signature", documents: docs });
async function legalStore(api: Record<string, unknown>) {
  const store = loadStorefront({ storage: cart, api: { products: [apiProduct()], order: ok, ...api } as never });
  await store.fn<() => Promise<void>>("loadCatalog")();
  await store.fn<() => Promise<unknown>>("loadLegalRequirements")();
  await store.fn<() => Promise<void>>("loadCheckoutCharges")();
  return store;
}
const run = (store: Awaited<ReturnType<typeof legalStore>>, name: string) => store.fn<(...a: unknown[]) => unknown>(name);

test("H3.1-B the version label is omitted, never 'undefined', when a version is missing or malformed", async () => {
  const store = await legalStore({});
  const label = run(store, "legalVersionLabel") as (d: unknown) => string;
  assert.equal(label({ version: 3 }), " — Sürüm 3");
  assert.equal(label({ version: "4" }), " — Sürüm 4");
  for (const bad of [{}, { version: undefined }, { version: null }, { version: "undefined" }, { version: 0 }, { version: -1 }, { version: 1.5 }, { version: "" }, { version: "abc" }]) assert.equal(label(bad), "", JSON.stringify(bad));
});

test("H3.1-B required documents must be identifiable; empty, malformed or duplicate lists leave the order blocked", async () => {
  const bads = [[], [{ slug: "a", title: "T" }], [{ slug: "a", title: "  ", versionId: "v1" }], [{ slug: "a", title: "T", versionId: "undefined" }], [{ slug: "a", title: "T", versionId: "v1", version: 0 }], [{ slug: "a", title: "T", versionId: "v1" }, { slug: "b", title: "U", versionId: "v1" }]];
  for (const docs of bads) {
    const store = await legalStore({ legalRequired: jsonRes(200, { documents: docs }) });
    assert.equal(await run(store, "loadLegalRequirements")(), null, JSON.stringify(docs));
    const { f, result } = checkoutForm();
    await store.fn<(e: unknown) => Promise<void>>("submitOrder")({ preventDefault: () => {}, currentTarget: f });
    assert.equal(store.orderBodies.length, 0, "no order request while required documents are unusable");
    assert.ok(result.textContent.length > 0);
  }
  const good = await legalStore({ legalRequired: jsonRes(200, { documents: [{ slug: "distance-sales", title: "T", versionId: "v1" }] }) });
  assert.equal(Array.isArray(await run(good, "loadLegalRequirements")()), true);
});

test("H3.1-B an unusable or incomplete legal preview blocks the order; a complete one passes", async () => {
  const cases: [string, unknown[]][] = [
    ["missing version", [{ ...goodDoc, version: undefined }]], ["zero version", [{ ...goodDoc, version: 0 }]], ["textual undefined", [{ ...goodDoc, version: "undefined" }]],
    ["empty body", [{ ...goodDoc, renderedBody: "" }]], ["missing id", [{ ...goodDoc, documentVersionId: undefined }]], ["missing title", [{ ...goodDoc, title: " " }]], ["duplicate ids", [goodDoc, goodDoc]],
  ];
  for (const [name, docs] of cases) {
    const store = await legalStore({ legalPreview: preview(docs) });
    const { f } = checkoutForm();
    assert.equal(await store.fn<(form: unknown) => Promise<unknown>>("requestLegalPreview")(f), null, name);
    await store.fn<(e: unknown) => Promise<void>>("submitOrder")({ preventDefault: () => {}, currentTarget: f });
    assert.equal(store.orderBodies.length, 0, name + ": no order request");
  }
  const store = await legalStore({ legalPreview: preview([goodDoc]) });
  assert.ok(await store.fn<(form: unknown) => Promise<unknown>>("requestLegalPreview")(checkoutForm().f), "a complete preview is accepted");
});

test("H3.1-B server 503 for missing legal documents or notice is explained and keeps the cart", async () => {
  for (const [code, text] of [["LEGAL_DOCUMENTS_UNAVAILABLE", /Zorunlu hukuki belgeler şu anda eksik veya doğrulanamıyor/], ["LEGAL_NOTICE_UNAVAILABLE", /Aydınlatma metni henüz yayınlanmadığı için sipariş şu anda alınamıyor/]] as const) {
    const previewStore = await legalStore({ legalPreview: jsonRes(503, { error: "x", code }) });
    const { f } = checkoutForm();
    assert.equal(await previewStore.fn<(form: unknown) => Promise<unknown>>("requestLegalPreview")(f), null);
    const orderStore = await legalStore({ order: jsonRes(503, { error: "x", code }) });
    const form = checkoutForm();
    assert.ok(await orderStore.fn<(form: unknown) => Promise<unknown>>("requestLegalPreview")(form.f));
    await orderStore.fn<(e: unknown) => Promise<void>>("submitOrder")({ preventDefault: () => {}, currentTarget: form.f });
    assert.match(form.result.textContent, text);
    assert.equal(form.button.textContent, "", "the submit label is restored, not stuck on 'Sipariş kaydediliyor…'");
    assert.deepEqual(JSON.parse(JSON.stringify(orderStore.fn<() => unknown>("readCartRaw")())), cart["ege-cart"]);
  }
});

test("H3.1-B an unpublished KVKK notice blocks the order with an explanation; a failed lookup does not", async () => {
  const slot = fakeElement();
  const missing = loadStorefront({ storage: cart, elements: { "[data-kvkk-notice]": slot }, api: { products: [apiProduct()], order: ok, legalDocuments: jsonRes(200, { documents: [{ slug: "distance-sales", title: "x", versionId: "v" }] }) } as never });
  await missing.fn<() => Promise<void>>("loadCatalog")();
  await missing.fn<() => Promise<void>>("renderKvkkNotices")();
  assert.match(slot.innerHTML, /henüz yayınlanmamıştır; bu nedenle sipariş şu anda alınamıyor/);
  const form = checkoutForm();
  assert.equal(await missing.fn<(f: unknown) => Promise<unknown>>("requestLegalPreview")(form.f), null);
  await missing.fn<(e: unknown) => Promise<void>>("submitOrder")({ preventDefault: () => {}, currentTarget: form.f });
  assert.equal(missing.orderBodies.length, 0);
  assert.match(form.result.textContent, /Aydınlatma metni henüz yayınlanmadığı için sipariş şu anda alınamıyor/);
  const slot2 = fakeElement();
  const unknown = loadStorefront({ storage: cart, elements: { "[data-kvkk-notice]": slot2 }, api: { products: [apiProduct()], order: ok, legalDocuments: () => Promise.reject(new Error("network")) } as never });
  await unknown.fn<() => Promise<void>>("loadCatalog")();
  await unknown.fn<() => Promise<void>>("renderKvkkNotices")();
  assert.match(slot2.innerHTML, /şu anda yüklenemedi/);
  assert.doesNotMatch(slot2.innerHTML, /yayınlanmamıştır/, "a failed lookup is not reported as 'unpublished'");
});

test("H3.1-B synthetic test data never lives in application code", () => {
  // Server-owned Preview fixtures are a separate, earlier boundary (lib/legal-fixture-registry.ts, tests/reserved-preview-fixture.test.ts).
  const forbidden = /ETS-H3-SYNTH|h3-synthetic|TEST SENTETİK|TEST SENTETIK|Sentetik satış koşulları|h3-terms|h3-distance/;
  for (const dir of ["public", "app", "components", "hooks"]) {
    for (const file of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
      if (!/\.(js|mjs|ts|tsx|html|css|json)$/.test(file)) continue;
      assert.doesNotMatch(readFileSync(`${dir}/${file}`, "utf8"), forbidden, `${dir}/${file}`);
    }
  }
  assert.ok(readFileSync("scripts/fixtures/h31-synthetic-legal.mjs", "utf8").includes("TEST SENTETİK"), "fixtures are declared in one clearly named test-only module");
});
