import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createProductSchema, patchProductSchema } from "../lib/admin-product-schema.ts";
import {
  DEFAULT_DELIVERY_CLASS, deliveryClassBadge, deliveryClassBadges, deliveryClassDescriptions, deliveryClassLabel, deliveryClassLabels, deliveryClasses, publicDeliveryTraits,
} from "../lib/delivery-classes.ts";
import * as delivery from "../lib/delivery.ts";
import { deliverySummaryFromSnapshot } from "../lib/order-domain.ts";
import { describeOrderDelivery, readDeliverySnapshot } from "../lib/order-delivery.ts";
import { apiProduct, fakeElement, loadStorefront } from "./support/storefront-sandbox.ts";

/** Phase 3.4C: the admin side of the delivery domain (product class, list badge, order detail), with legacy orders left intact. */
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const validProduct = { name: "Test Ürün", slug: "test-urun", category: "Klima", price: 1000, stock: 1, saleMode: "online", status: "draft" };

// ---- admin API validation -------------------------------------------------------------------------------
test("creating a product defaults the delivery class to installed_delivery", () => {
  const parsed = createProductSchema.parse(validProduct);
  assert.equal(parsed.deliveryClass, "installed_delivery");
  assert.equal(DEFAULT_DELIVERY_CLASS, "installed_delivery");
});
test("create and update accept exactly the three known classes", () => {
  for (const deliveryClass of deliveryClasses) {
    assert.equal(createProductSchema.parse({ ...validProduct, deliveryClass }).deliveryClass, deliveryClass);
    assert.equal(patchProductSchema.parse({ deliveryClass }).deliveryClass, deliveryClass);
  }
  assert.deepEqual([...deliveryClasses], ["installed_delivery", "shippable", "local_delivery"]);
});
test("an unknown delivery class is refused by the application (fail-closed), on create and on update", () => {
  for (const bad of ["", "klima", "SHIPPABLE", "Installed_Delivery", "installed_delivery ", "shippable;drop", null, 0, 1, true, {}, []]) {
    assert.equal(createProductSchema.safeParse({ ...validProduct, deliveryClass: bad }).success, false, `create ${JSON.stringify(bad)}`);
    assert.equal(patchProductSchema.safeParse({ deliveryClass: bad }).success, false, `update ${JSON.stringify(bad)}`);
  }
});
test("an update that omits the class leaves it out of the patch (nothing is reset to the default)", () => {
  const patch = patchProductSchema.parse({ price: 1500 });
  assert.equal("deliveryClass" in patch, false);
});
test("the admin routes validate through these schemas, so the database CHECK is a second line of defence only", () => {
  assert.match(read("app/api/admin/products/route.ts"), /createProductSchema\.safeParse\(/);
  assert.match(read("app/api/admin/products/[id]/route.ts"), /patchProductSchema\.safeParse\(/);
  const schemaSrc = read("lib/admin-product-schema.ts");
  assert.match(schemaSrc, /deliveryClass: z\.enum\(deliveryClasses\)\.default\(DEFAULT_DELIVERY_CLASS\)/);
  assert.match(schemaSrc, /deliveryClass:z\.enum\(deliveryClasses\)\.optional\(\)/);
});

// ---- one source for the wording -----------------------------------------------------------------------------
test("labels, descriptions and badges are the approved Turkish texts", () => {
  assert.deepEqual(deliveryClassLabels, { installed_delivery: "Adrese teslim + standart montaj", shippable: "Kargoya uygun", local_delivery: "Yerel teslimat" });
  assert.deepEqual(deliveryClassBadges, { installed_delivery: "Montajlı teslimat", shippable: "Kargoya uygun", local_delivery: "Yerel teslimat" });
  assert.equal(deliveryClassDescriptions.installed_delivery, "Ürün Ege Teknik hizmet bölgesinde adrese teslim edilir ve standart montajı fiyata dahildir.");
  assert.equal(deliveryClassDescriptions.shippable, "Ürün mağazadan teslim alınabilir veya kargo tarifesi aktif olduğunda kargolanabilir.");
  assert.equal(deliveryClassDescriptions.local_delivery, "Ürün Ege Teknik hizmet bölgesinde bayi teslimatıyla gönderilir; standart montaj kapsamı ürün tipine göre uygulanır.");
  for (const c of deliveryClasses) for (const text of [deliveryClassLabels[c], deliveryClassBadges[c], deliveryClassDescriptions[c]]) assert.equal(text.includes("_"), false, `a raw enum value leaked into "${text}"`);
});
test("an unknown stored value gets no invented label or badge", () => {
  assert.equal(deliveryClassLabel("klima"), "—");
  assert.equal(deliveryClassLabel(undefined), "—");
  assert.equal(deliveryClassBadge("klima"), null);
  assert.equal(deliveryClassBadge(null), null);
  assert.equal(deliveryClassBadge("shippable"), "Kargoya uygun");
});
test("the domain stays one module: delivery.ts re-exports the classes and the storefront trait table is derived from them", () => {
  assert.equal(delivery.deliveryTraits("installed_delivery").installationIncluded, true);
  assert.equal(delivery.deliveryClassBadges, deliveryClassBadges);
  assert.deepEqual(Object.keys(publicDeliveryTraits).sort(), [...deliveryClasses].sort());
  assert.deepEqual(publicDeliveryTraits.shippable, { installationIncluded: false, shippingEligible: true, dealerDelivered: false });
});
test("the wording is defined only in lib/delivery-classes.ts, never re-typed in the UI", () => {
  const files: string[] = [];
  const walk = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) { if (!["node_modules", ".next"].includes(name)) walk(path); } else if (/\.(tsx?|mjs)$/.test(name)) files.push(path); } };
  for (const dir of ["app", "components", "lib"]) walk(dir);
  for (const file of files.filter((f) => !f.endsWith("lib/delivery-classes.ts"))) {
    const src = readFileSync(file, "utf8");
    for (const phrase of ["Adrese teslim + standart montaj", "Montajlı teslimat", "standart montajı fiyata dahildir"]) assert.equal(src.includes(phrase), false, `${file} re-types "${phrase}"`);
  }
});
test("client components import the dependency-free class module, not lib/delivery.ts (which would pull node:crypto into the browser bundle)", () => {
  assert.doesNotMatch(read("lib/delivery-classes.ts"), /^import /m, "the class module has no imports at all");
  for (const file of ["app/admin/(panel)/products/product-form.tsx", "app/admin/(panel)/products/products-view.tsx"]) {
    const src = read(file);
    assert.match(src, /from "@\/lib\/delivery-classes"/, file);
    assert.doesNotMatch(src, /from "@\/lib\/delivery"/, file);
  }
});

// ---- admin UI ---------------------------------------------------------------------------------------------------
test("the product form has a 'Teslimat tipi' select of human labels with a live description; the raw enum is only the option value", () => {
  const form = read("app/admin/(panel)/products/product-form.tsx");
  assert.match(form, /label="Teslimat tipi" htmlFor="p-delivery-class" hint=\{deliveryClassDescriptions\[form\.deliveryClass\]\}/);
  assert.match(form, /deliveryClasses\.map\(\(c\) => <option key=\{c\} value=\{c\}>\{deliveryClassLabels\[c\]\}<\/option>\)/);
  assert.doesNotMatch(form, />\{c\}<\/option>/, "never show the raw value as the visible label");
  assert.match(form, /deliveryClass: DEFAULT_DELIVERY_CLASS as DeliveryClass/, "a new product starts as installed_delivery");
  assert.match(form, /deliveryClass: isDeliveryClass\(product\.deliveryClass\) \? product\.deliveryClass : DEFAULT_DELIVERY_CLASS/, "an existing product shows its stored value");
  assert.match(form, /if \(isDeliveryClass\(e\.target\.value\)\) set\("deliveryClass", e\.target\.value\)/, "only a known value can be selected");
});
test("the product list shows a compact delivery badge inside the existing category cell, without a new column", () => {
  const view = read("app/admin/(panel)/products/products-view.tsx");
  assert.match(view, /deliveryClassBadge\(p\.deliveryClass\)/);
  assert.equal((view.match(/<TableHead[\s>]/g) ?? []).length, 6, "the table did not grow: Ürün, Kategori, Fiyat, Stok, Durum, İşlem");
});
test("the admin product type carries the stored class, and the overview endpoint returns whole product rows", () => {
  assert.match(read("components/admin/use-admin-data.ts"), /saleMode: string; deliveryClass: string;/);
  assert.match(read("app/api/admin/overview/route.ts"), /products: productRows\.map\(\(\{ product, stock \}\) => \(\{ \.\.\.product, stock: stock \?\? 0 \}\)\)/);
});

// ---- order detail: new snapshot, legacy orders, malformed data ----------------------------------------------
test("a new dealer order reads back as province, district, method, region, standard installation included and no shipping fee", () => {
  const view = describeOrderDelivery({
    city: "İzmir", shippingTotal: 0, installationPreference: "included_standard",
    shippingAddressSnapshot: { recipientName: "Ada", city: "İzmir", district: "Bornova", line1: "x", delivery: { method: "dealer", region: "service", shippingFee: 0, installationIncluded: true } },
  });
  assert.deepEqual(view, { province: "İzmir", district: "Bornova", method: "Adrese teslim (Ege Teknik)", region: "Ege Teknik hizmet bölgesi", shippingFee: null, installation: "Standart montaj dahil", hasSnapshot: true });
});
test("a new pickup order and a new shipping order (with its fee) read back correctly", () => {
  const pickup = describeOrderDelivery({ city: "", shippingTotal: 0, installationPreference: "none", shippingAddressSnapshot: { district: "", delivery: { method: "pickup", region: "none", shippingFee: 0, installationIncluded: false } } });
  assert.equal(pickup.method, "Mağazadan teslim");
  assert.equal(pickup.province, "—");
  assert.equal(pickup.region, "—");
  assert.equal(pickup.shippingFee, null);
  assert.equal(pickup.installation, "Montaj yok");
  const shipping = describeOrderDelivery({ city: "Ankara", shippingTotal: 600, installationPreference: "none", shippingAddressSnapshot: { district: "Çankaya", delivery: { method: "shipping", region: "outside", shippingFee: 600, installationIncluded: false } } });
  assert.equal(shipping.method, "Kargo");
  assert.equal(shipping.region, "Hizmet bölgesi dışı");
  assert.equal(shipping.shippingFee, 600);
});
test("legacy orders (no delivery snapshot) do not break: missing fields become '—' and the old installation values get explicit legacy labels", () => {
  const legacy = describeOrderDelivery({ city: "Aydın", shippingTotal: 0, installationPreference: "delivery_only", shippingAddressSnapshot: { recipientName: "Ada", phone: "05", city: "Aydın", line1: "Adres" } });
  assert.deepEqual(legacy, { province: "Aydın", district: "—", method: "—", region: "—", shippingFee: null, installation: "Kurulum yok (eski model)", hasSnapshot: false });
  assert.equal(describeOrderDelivery({ city: "İzmir", installationPreference: "survey_then_install", shippingTotal: 500 }).installation, "Kurulum istendi (eski model, keşif sonrası fiyatlandırma)");
  assert.equal(describeOrderDelivery({ city: "İzmir", installationPreference: "survey_then_install", shippingTotal: 500 }).shippingFee, 500, "a legacy delivery charge is still shown");
  const bare = describeOrderDelivery({});
  assert.deepEqual(bare, { province: "—", district: "—", method: "—", region: "—", shippingFee: null, installation: "—", hasSnapshot: false });
});
test("malformed or hostile snapshot data never throws and never leaks into the view", () => {
  for (const snapshot of [null, undefined, "text", 42, [], [1, 2], { delivery: "x" }, { delivery: { method: 5, region: {}, shippingFee: "600", installationIncluded: "yes" }, district: 7 }, { delivery: { method: "<script>alert(1)</script>", region: "moon" } }]) {
    const view = describeOrderDelivery({ city: "İzmir", installationPreference: "weird", shippingTotal: 0, shippingAddressSnapshot: snapshot });
    for (const value of [view.method, view.region, view.installation, view.district]) assert.equal(/<script|\[object|undefined|NaN/.test(value), false, JSON.stringify(snapshot));
  }
  assert.deepEqual(readDeliverySnapshot("nope"), { district: "", method: "", region: "", shippingFee: null, installationIncluded: null });
});
test("the order confirmation replay reads the same snapshot through the one reader", () => {
  assert.deepEqual(deliverySummaryFromSnapshot({ district: "Bornova", delivery: { method: "dealer" } }), { district: "Bornova", deliveryMethod: "dealer" });
  assert.deepEqual(deliverySummaryFromSnapshot(null), { district: "", deliveryMethod: "" });
});
test("the admin order screen renders the readable view, never raw JSON, and only charges that were really made", () => {
  const view = read("app/admin/(panel)/orders/order-detail-view.tsx");
  assert.match(view, /describeOrderDelivery\(order\)/);
  for (const label of ["İl", "İlçe", "Teslimat yöntemi", "Teslimat bölgesi", "Kargo bedeli", "Montaj"]) assert.ok(view.includes(`>${label}</dt>`), label);
  assert.doesNotMatch(view, /JSON\.stringify|shippingAddressSnapshot/, "the raw snapshot is not rendered");
  assert.match(view, /order\.shippingTotal > 0/, "no shipping row unless a fee was charged");
  assert.match(view, /order\.installationTotal > 0/, "no installation row for orders where it is included in the price");
  assert.match(view, /güncellenmeden önce oluşturulmuş/, "legacy orders explain the missing fields");
});
test("legacy orders are never migrated: no migration touches order data for this model", () => {
  const sql = read("drizzle-pg/0012_delivery_class.sql");
  assert.doesNotMatch(sql, /\borders\b|\border_items\b/);
});

// ---- product page notes (storefront) --------------------------------------------------------------------------
test("the public product detail carries the delivery class (the same stored value the checkout uses) and nothing else new", () => {
  assert.match(read("lib/product-enrichment.ts"), /saleMode: pick\("saleMode"\), deliveryClass: pick\("deliveryClass"\), stock: stock \?\? 0,/);
});
test("product-page delivery notes follow the stored class: installed delivery includes standard installation, the retired 'optional installation' wording is gone", () => {
  const notes = loadStorefront().fn<(p: unknown, sale: boolean) => string[]>("deliveryNotes");
  assert.deepEqual([...notes({ deliveryClass: "installed_delivery" }, true)], ["Standart montaj ürün fiyatına dahildir.", "Ege Teknik hizmet bölgesinde adrese teslim edilir; ayrıca teslimat ücreti alınmaz."]);
  assert.deepEqual([...notes({ deliveryClass: "shippable" }, true)], ["Mağazadan teslim alabilirsiniz.", "Kargo seçeneği, tarifesi aktif olduğunda ödeme adımında sunulur."]);
  assert.deepEqual([...notes({ deliveryClass: "local_delivery" }, true)], ["Ürün Ege Teknik hizmet bölgesinde bayi teslimatıyla gönderilir.", "Standart montaj kapsamı ürün tipine göre uygulanır."]);
  for (const unknown of [undefined, "", "klima", null]) assert.deepEqual([...notes({ deliveryClass: unknown }, true)], ["Teslimat ve montaj bilgisi ödeme adımında gösterilir."], String(unknown));
  assert.deepEqual([...notes({ deliveryClass: "installed_delivery" }, false)], ["Teslimat ve montaj koşulları teklif sürecinde netleşir."], "a quote-priced product promises nothing");
  const all = ["installed_delivery", "shippable", "local_delivery", "x"].flatMap((c) => [...notes({ deliveryClass: c }, true)]).join(" ");
  assert.doesNotMatch(all, /isteğe bağlı|ayrıca seçilir ve fiyatlandırılır|[Üü]cretsiz|[Bb]edava/);
  assert.doesNotMatch(read("public/store.js"), /Kurulum isteğe bağlıdır/);
});

test("product detail install/delivery card follows the delivery class and never says installation is optional or separately priced", async () => {
  for (const [deliveryClass, expected] of [["installed_delivery", /Standart montaj ürün fiyatına dahildir/], ["shippable", /Kargo tarifesi aktif olduğunda/], ["local_delivery", /bayi teslimatıyla/]] as const) {
    const root = fakeElement();
    const store = loadStorefront({ path: "product.html", search: "?id=p1", elements: { "[data-product-page]": root }, api: { products: [apiProduct({ id: "p1", name: "Test Ürün", stock: 1, deliveryClass })] } });
    await store.fn<() => Promise<void>>("loadCatalog")();
    assert.match(root.innerHTML, expected, deliveryClass);
    assert.doesNotMatch(root.innerHTML, /Kurulum isteğe bağlıdır|ayrıca fiyatlandırılır|ödeme adımında veya teklif akışında ayrı olarak seçilebilir/, deliveryClass);
    if (deliveryClass === "shippable") assert.doesNotMatch(root.innerHTML, /borulama|Standart montaj/, "no installation text on a shippable part");
  }
});

test("admin order detail contact links keep a 44px touch target", () => {
  const src = readFileSync(new URL("../app/admin/(panel)/orders/order-detail-view.tsx", import.meta.url), "utf8");
  for (const scheme of ["tel:", "mailto:"]) assert.match(src, new RegExp(`min-h-11[^>]*href=\\{\`${scheme}`));
});
