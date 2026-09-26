import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { CONFIGURED_SHIPPING, DEFAULT_CHARGES, apiProduct, fakeElement, loadStorefront } from "./support/storefront-sandbox.ts";
import {
  DISTRICTS_BY_PROVINCE, EGE_TEKNIK_SERVICE_PROVINCES, SERVICE_AREA_MESSAGE, TURKEY_PROVINCES, canonicalDistrict, canonicalProvince, foldTr, planDelivery, type ProvinceName,
} from "../lib/delivery.ts";

/** Phase 3.4B revision: nine-province service area, and province -> district validated on the server from ONE canonical dataset. */
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const AC = "installed_delivery", PART = "shippable", HEAVY = "local_delivery";
const ok = (r: ReturnType<typeof planDelivery>) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.ok ? r.plan : (undefined as never); };
const err = (r: ReturnType<typeof planDelivery>) => { assert.equal(r.ok, false, "expected a refusal"); return r.ok ? (undefined as never) : r.error; };
const districts = (p: ProvinceName) => DISTRICTS_BY_PROVINCE[p] as readonly string[];

// ---- the dataset ---------------------------------------------------------------------------------------------------
test("81 provinces, each unique, and 973 districts in total", () => {
  assert.equal(TURKEY_PROVINCES.length, 81);
  assert.equal(new Set(TURKEY_PROVINCES).size, 81);
  assert.equal(new Set(TURKEY_PROVINCES.map(foldTr)).size, 81, "no two provinces collapse to the same normalised name");
  assert.equal(TURKEY_PROVINCES.reduce((n, p) => n + districts(p).length, 0), 973);
});
test("no province has an empty district list, no duplicate district inside a province (exact or normalised), and no blank names", () => {
  for (const p of TURKEY_PROVINCES) {
    const list = districts(p);
    assert.ok(list.length > 0, `${p} has no districts`);
    assert.equal(new Set(list).size, list.length, `${p}: duplicate district`);
    assert.equal(new Set(list.map(foldTr)).size, list.length, `${p}: two districts collapse to one normalised name`);
    for (const d of list) assert.ok(d.trim() === d && d.length > 1, `${p}: bad district "${d}"`);
  }
});
test("the canonical dataset is frozen by checksum: an accidental edit fails here, an intentional refresh updates the constant", () => {
  const sha = createHash("sha256").update(JSON.stringify(DISTRICTS_BY_PROVINCE), "utf8").digest("hex");
  assert.equal(sha, "d46af17ac9cc3051d5c962409c56d2933d6fe93141b4dfe2bf9eccdc3ab1f57e");
});
test("Turkish characters are kept and every province is a well-known real name", () => {
  for (const name of ["İzmir", "Şanlıurfa", "Çanakkale", "Muğla", "Kırklareli", "Iğdır", "Uşak", "Gümüşhane", "Kütahya", "Balıkesir"]) assert.ok((TURKEY_PROVINCES as readonly string[]).includes(name), name);
  assert.ok(districts("İzmir").includes("Karşıyaka") && districts("Kütahya").includes("Tavşanlı") && districts("Afyonkarahisar").includes("Sandıklı"));
  assert.equal(TURKEY_PROVINCES.some((p) => /[a-z]{2,}\?|�/.test(p)), false, "no mangled characters");
});
test("the dataset lives in exactly one file: no other source file re-types a district list", () => {
  const files: string[] = [];
  const walk = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) { if (!["node_modules", ".next"].includes(name)) walk(path); } else if (/\.(tsx?|mjs|js|html)$/.test(name)) files.push(path); } };
  for (const dir of ["app", "components", "lib", "public"]) walk(dir);
  for (const file of files.filter((f) => !f.endsWith("lib/turkey-locations.ts"))) {
    const src = readFileSync(file, "utf8");
    assert.equal(src.includes("Seferihisar") && src.includes("Torbalı"), false, `${file} carries its own copy of a district list`);
  }
});

// ---- validation: pairs given in the brief -------------------------------------------------------------------------
test("valid province/district pairs", () => {
  for (const [p, d] of [["İzmir", "Bornova"], ["İzmir", "Konak"], ["İzmir", "Karşıyaka"], ["Aydın", "Kuşadası"], ["Aydın", "Didim"], ["Muğla", "Bodrum"], ["Muğla", "Fethiye"], ["Manisa", "Turgutlu"], ["Denizli", "Pamukkale"], ["Balıkesir", "Edremit"], ["Kütahya", "Tavşanlı"], ["Afyonkarahisar", "Sandıklı"]] as const) {
    assert.equal(canonicalDistrict(canonicalProvince(p)!, d), d, `${p}/${d}`);
    assert.equal(ok(planDelivery({ classes: [AC], province: p, district: d })).district, d);
  }
});
test("İzmir/Bodrum is refused with 422 - a real district, but of Muğla; Muğla/Bodrum is valid", () => {
  const e = err(planDelivery({ classes: [AC], province: "İzmir", district: "Bodrum" }));
  assert.equal(e.code, "INVALID_DISTRICT");
  assert.equal(e.status, 422);
  assert.equal(ok(planDelivery({ classes: [AC], province: "Muğla", district: "Bodrum" })).district, "Bodrum");
});
test("case and diacritic normalisation to the canonical names, and NO fuzzy matching", () => {
  const plan = ok(planDelivery({ classes: [AC], province: "IZMIR", district: "bornova" }));
  assert.deepEqual([plan.province, plan.district], ["İzmir", "Bornova"]);
  for (const [p, d, want] of [["izmir", "CESME", "Çeşme"], ["AYDIN", "kusadasi", "Kuşadası"], ["kutahya", "TAVSANLI", "Tavşanlı"], ["afyonkarahisar", "sandikli", "Sandıklı"], ["MUGLA", "  bodrum  ", "Bodrum"], ["ıZMİR", "KARSIYAKA", "Karşıyaka"]] as const) assert.equal(ok(planDelivery({ classes: [AC], province: p, district: d })).district, want, `${p}/${d}`);
  for (const typo of ["Bornov", "Bornovaa", "Born ova", "Bornova Merkez", "Bornova/Konak", "Bornoba"]) assert.equal(err(planDelivery({ classes: [AC], province: "İzmir", district: typo })).code, "INVALID_DISTRICT", typo);
  assert.equal(canonicalProvince("Izmr"), null);
  assert.equal(canonicalDistrict("İzmir", "Bornva"), null);
});
test("unknown province, unknown district and a district of the wrong province are refused", () => {
  assert.equal(err(planDelivery({ classes: [AC], province: "Atlantis", district: "Merkez" })).code, "INVALID_PROVINCE");
  assert.equal(err(planDelivery({ classes: [AC], province: "İzmir", district: "Atlantis" })).code, "INVALID_DISTRICT");
  assert.equal(err(planDelivery({ classes: [AC], province: "Aydın", district: "Bornova" })).code, "INVALID_DISTRICT", "a real district of another province");
  assert.equal(canonicalDistrict("İzmir", ""), null);
});

// ---- when the district is required -----------------------------------------------------------------------------------
test("dealer delivery (installed and local) requires a district; a blank one is refused", () => {
  for (const cls of [AC, HEAVY]) for (const district of ["", "   "]) {
    const e = err(planDelivery({ classes: [cls], province: "İzmir", district }));
    assert.equal(e.code, "DISTRICT_REQUIRED");
    assert.equal(e.status, 400);
  }
  assert.equal(err(planDelivery({ classes: [AC, PART], province: "İzmir", district: "" })).code, "DISTRICT_REQUIRED", "a mixed cart is dealer delivery too");
});
test("carrier shipping requires province AND district, so the domain is ready for when the tariff is activated", () => {
  const tariffs = CONFIGURED_SHIPPING.shipping.status === "configured" ? { shipping: { status: "configured" as const, amount: 600, vatRateBps: 2000 } } : undefined;
  assert.equal(err(planDelivery({ classes: [PART], province: "Ankara", district: "", method: "shipping", tariffs })).code, "DISTRICT_REQUIRED");
  assert.equal(err(planDelivery({ classes: [PART], province: "", district: "", method: "shipping", tariffs })).code, "INVALID_PROVINCE");
  const plan = ok(planDelivery({ classes: [PART], province: "Ankara", district: "Çankaya", method: "shipping", tariffs }));
  assert.deepEqual([plan.province, plan.district, plan.region, plan.shipping.amount], ["Ankara", "Çankaya", "outside", 600]);
  assert.equal(err(planDelivery({ classes: [PART], province: "Ankara", district: "Bornova", method: "shipping", tariffs })).code, "INVALID_DISTRICT");
});
test("pickup needs neither province nor district, but whatever is given must be valid", () => {
  const bare = ok(planDelivery({ classes: [PART], province: "", district: "" }));
  assert.deepEqual([bare.method, bare.province, bare.district, bare.region], ["pickup", "", "", "none"]);
  assert.equal(ok(planDelivery({ classes: [PART], province: "Ankara", district: "" })).district, "");
  assert.equal(ok(planDelivery({ classes: [PART], province: "ankara", district: "cankaya" })).district, "Çankaya");
  assert.equal(err(planDelivery({ classes: [PART], province: "", district: "Bornova" })).code, "INVALID_PROVINCE", "a district without its province");
  assert.equal(err(planDelivery({ classes: [PART], province: "İzmir", district: "Bodrum" })).code, "INVALID_DISTRICT", "a manipulated combination");
  assert.equal(err(planDelivery({ classes: [PART], province: "Atlantis", district: "" })).code, "INVALID_PROVINCE");
});

// ---- the service area ------------------------------------------------------------------------------------------------
test("all nine service provinces are accepted for installed and local delivery, and every one of their districts", () => {
  assert.equal(EGE_TEKNIK_SERVICE_PROVINCES.length, 9);
  let checked = 0;
  for (const province of EGE_TEKNIK_SERVICE_PROVINCES) for (const district of districts(province)) for (const cls of [AC, HEAVY]) {
    const plan = ok(planDelivery({ classes: [cls], province, district }));
    assert.deepEqual([plan.province, plan.district, plan.region, plan.method], [province, district, "service", "dealer"]);
    checked++;
  }
  assert.equal(checked, EGE_TEKNIK_SERVICE_PROVINCES.reduce((n, p) => n + districts(p).length, 0) * 2);
  assert.ok(checked > 200);
});
test("every other province is refused for installed and local delivery with the exact service-area message (after a valid district)", () => {
  const outside = TURKEY_PROVINCES.filter((p) => !(EGE_TEKNIK_SERVICE_PROVINCES as readonly string[]).includes(p));
  assert.equal(outside.length, 72);
  for (const province of outside) for (const cls of [AC, HEAVY]) {
    const e = err(planDelivery({ classes: [cls], province, district: districts(province)[0] }));
    assert.equal(e.code, "SERVICE_AREA_UNAVAILABLE", province);
    assert.equal(e.status, 422);
    assert.equal(e.message, "Bu ürün için şu anda Ege Teknik hizmet bölgesi içinde teslimat ve kurulum hizmeti sunuyoruz.");
  }
  assert.equal(SERVICE_AREA_MESSAGE, "Bu ürün için şu anda Ege Teknik hizmet bölgesi içinde teslimat ve kurulum hizmeti sunuyoruz.");
});
test("the service area is a business coverage list, not the geographic Ege region, and no delivery text still says so", () => {
  const deliveryTexts: [string, string][] = [
    ["checkout.html", read("public/checkout.html")], ["lib/delivery.ts (messages)", read("lib/delivery.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")],
    ["lib/delivery-classes.ts", read("lib/delivery-classes.ts").replace(/\/\*[\s\S]*?\*\//g, "")], ["lib/order-delivery.ts", read("lib/order-delivery.ts").replace(/\/\*[\s\S]*?\*\//g, "")],
    ["docs distance-sales", read("docs/legal-drafts/distance-sales.md")], ["docs delivery-returns", read("docs/legal-drafts/delivery-returns.md")],
    ["docs pre-information", read("docs/legal-drafts/pre-information.md")], ["docs installation", read("docs/legal-drafts/installation.md")],
  ];
  const js = read("public/store.js");
  deliveryTexts.push(["store.js checkout delivery block", js.slice(js.indexOf("let checkoutConfig"), js.indexOf("function marketingChoices"))]);
  deliveryTexts.push(["store.js product delivery notes", js.slice(js.indexOf("function deliveryNotes"), js.indexOf("function relatedProductsFor"))]);
  for (const [name, text] of deliveryTexts) assert.doesNotMatch(text, /Ege Bölgesi/, `${name} still claims the Ege Region`);
  assert.match(read("public/store.js"), /Ege Teknik hizmet bölgesinde adrese teslim/);
});

// ---- server route ----------------------------------------------------------------------------------------------------
test("the order route validates the pair server-side, refuses before any write, and stores the canonical names", () => {
  const route = read("app/api/orders/route.ts");
  assert.match(route, /planDelivery\(\{ classes: rows\.map\(\(\{ product \}\) => product\.deliveryClass\), province: parsed\.data\.city, district: parsed\.data\.district, method: parsed\.data\.delivery \}\)/);
  assert.ok(route.indexOf("planDelivery(") < route.indexOf("db.transaction"));
  assert.match(route, /if \(!delivery\.ok\) return Response\.json\(\{ error: delivery\.error\.message, code: delivery\.error\.code \}, \{ status: delivery\.error\.status \}\)/);
  assert.match(route, /city: plan\.province, district: plan\.district, line1/);
  assert.doesNotMatch(route, /district: parsed\.data\.district, line1|city: parsed\.data\.city, address/);
});

// ---- checkout UI -----------------------------------------------------------------------------------------------------
async function checkout(city: string, district = "") {
  const elements = { "[data-province]": { ...fakeElement(), value: city }, "[data-district]": { ...fakeElement(), disabled: false, value: district }, "[name=city]": { value: city }, "[name=district]": { value: district, required: false }, "[name=address]": { value: "", required: false }, "[data-charge-summary]": fakeElement(), "[data-total]": fakeElement(), "[data-charge-notice]": { ...fakeElement(), hidden: true }, "[data-submit-order]": { disabled: true }, "[data-delivery-options]": fakeElement(), "[data-address-hint]": fakeElement(), "[data-cart-items]": fakeElement(), "[data-subtotal]": fakeElement(), "[data-vat]": fakeElement() } as unknown as Record<string, ReturnType<typeof fakeElement>>;
  const store = loadStorefront({ path: "checkout.html", elements, storage: { "ege-cart": [{ productId: "synthetic-product-1", quantity: 1 }] }, api: { products: [apiProduct()], charges: DEFAULT_CHARGES } });
  await store.fn<() => Promise<void>>("loadCatalog")();
  await store.fn<() => Promise<void>>("loadCheckoutCharges")();
  return { store, elements };
}
test("the checkout has NO free-text district input; the district is a select that starts disabled with 'Önce il seçin'", () => {
  const html = read("public/checkout.html");
  assert.doesNotMatch(html, /<input[^>]*name="district"/);
  assert.match(html, /<select name="district" data-district autocomplete="address-level2" disabled><option value="">Önce il seçin<\/option><\/select>/);
  assert.match(html, /<select name="city" data-province autocomplete="address-level1">/);
});
test("without a province the district select is disabled and says 'Önce il seçin'", async () => {
  const { elements } = await checkout("");
  const d = elements["[data-district]"] as unknown as { disabled: boolean; innerHTML: string; value: string };
  assert.equal(d.disabled, true);
  assert.match(d.innerHTML, /Önce il seçin/);
  assert.equal(d.value, "");
});
test("choosing a province lists ONLY that province's districts, and the select is enabled", async () => {
  const { elements } = await checkout("Muğla");
  const d = elements["[data-district]"] as unknown as { disabled: boolean; innerHTML: string };
  assert.equal(d.disabled, false);
  assert.match(d.innerHTML, /İlçe seçin/);
  for (const name of districts("Muğla")) assert.ok(d.innerHTML.includes(`>${name}</option>`), name);
  assert.equal((d.innerHTML.match(/<option value="[^"]+"/g) ?? []).length, districts("Muğla").length);
  assert.equal(d.innerHTML.includes("Bornova"), false, "no district of another province");
});
test("changing the province clears the previously selected district", async () => {
  const { store, elements } = await checkout("İzmir", "Bornova");
  const d = elements["[data-district]"] as unknown as { value: string; innerHTML: string };
  assert.equal(d.value, "Bornova", "it is kept while the province is unchanged");
  (elements["[name=city]"] as unknown as { value: string }).value = "Muğla";
  store.fn<() => void>("onProvinceChange")();
  assert.equal(d.value, "", "the old district is cleared");
  assert.ok(d.innerHTML.includes(">Bodrum</option>") && !d.innerHTML.includes(">Bornova</option>"));
  assert.match(read("public/store.js"), /if\(t\.matches\('\[name=city\]'\)\)onProvinceChange\(\)/, "the province select's change event is wired to it");
});
test("the province select is filled from the API's dataset (81 options), never from a list in store.js", async () => {
  const { elements } = await checkout("");
  const html = (elements["[data-province]"] as unknown as { innerHTML: string }).innerHTML;
  assert.equal((html.match(/<option value="[^"]+"/g) ?? []).length, 81);
  assert.match(read("public/store.js"), /Object\.keys\(checkoutConfig\.locations\)/);
});
test("the API response carries the service provinces and the location dataset, and the server module is the only place they come from", () => {
  assert.equal(DEFAULT_CHARGES.serviceProvinces.length, 9);
  assert.equal(Object.keys(DEFAULT_CHARGES.locations).length, 81);
  assert.equal(DEFAULT_CHARGES.locations, DISTRICTS_BY_PROVINCE);
});
test("mobile: every checkout select is at least 44px high with 16px text (the shared field rule covers the two new selects)", () => {
  const css = read("public/store.css");
  assert.match(css, /@media\(max-width:650px\)\{\.field input,\.field select,\.field textarea\{font-size:16px;min-height:46px\}\}/);
  assert.match(css, /\.field select\{width:100%\}/);
  const html = read("public/checkout.html");
  assert.equal(/<label class="field">(İl|İlçe)<select/.test(html), true, "both selects sit inside .field labels");
});
