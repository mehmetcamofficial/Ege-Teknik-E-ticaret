import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CHECKOUT_TARIFFS, finalizeOrderTotals, type CheckoutTariffs } from "../lib/checkout-charges.ts";
import { catalogDefaults } from "../lib/catalog-defaults.ts";
import {
  DEFAULT_DELIVERY_CLASS, DISTRICTS_BY_PROVINCE, EGE_TEKNIK_SERVICE_PROVINCES, SERVICE_AREA_MESSAGE, TURKEY_PROVINCES, canonicalProvince, deliveryClasses, deliveryTraits, isDeliveryClass, planDelivery as planDeliveryRaw,
} from "../lib/delivery.ts";
import { reserveUnits } from "../lib/inventory.ts";
import { computeOrderTotals, orderRequestFingerprint, orderRequestSchema, priceOrderLines } from "../lib/order-domain.ts";

/** Phase 3.4 - delivery domain, checkout charges and their migration. No payment, no DB: pure rules plus source/SQL guards. */
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const route = read("app/api/orders/route.ts");
const deliverySrc = read("lib/delivery.ts");
const configuredShipping = (amount: number): CheckoutTariffs => ({ shipping: { status: "configured", amount, vatRateBps: 2000 } });
const AC = "installed_delivery", PART = "shippable", HEAVY = "local_delivery";
type PlanInput = Parameters<typeof planDeliveryRaw>[0];
/** planDelivery with the first real district of the province filled in, unless the test says otherwise. */
const firstDistrict = (province: string) => { const p = canonicalProvince(province); return p ? DISTRICTS_BY_PROVINCE[p][0] : ""; };
const planDelivery = (input: PlanInput) => planDeliveryRaw({ district: firstDistrict(input.province), ...input });
const ok = (r: ReturnType<typeof planDelivery>) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.ok ? r.plan : (undefined as never); };
const err = (r: ReturnType<typeof planDelivery>) => { assert.equal(r.ok, false); return r.ok ? (undefined as never) : r.error; };

// ---- the domain value ---------------------------------------------------------------------------
test("exactly three delivery classes exist, and the safe default is dealer delivery with installation", () => {
  assert.deepEqual([...deliveryClasses], ["installed_delivery", "shippable", "local_delivery"]);
  assert.equal(DEFAULT_DELIVERY_CLASS, "installed_delivery");
  assert.equal(isDeliveryClass("shippable"), true);
  for (const bad of ["", "klima", "SHIPPABLE", null, undefined, 5]) assert.equal(isDeliveryClass(bad), false, String(bad));
});
test("installation, shipping eligibility and dealer delivery are all derived from the one class", () => {
  assert.deepEqual(deliveryTraits(AC), { installationIncluded: true, shippingEligible: false, dealerDelivered: true });
  assert.deepEqual(deliveryTraits(HEAVY), { installationIncluded: false, shippingEligible: false, dealerDelivered: true });
  assert.deepEqual(deliveryTraits(PART), { installationIncluded: false, shippingEligible: true, dealerDelivered: false });
});
test("no business rule is guessed from a product name or category label", () => {
  assert.doesNotMatch(deliverySrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""), /\.name\b|\.category\b|includes\(["']klima|Yedek Parça/i);
  assert.doesNotMatch(route, /product\.(name|category)\b[^,;)]*(includes|match|test)\(/);
});

// ---- provinces / service area ------------------------------------------------------------------
test("the service area is exactly the nine Ege Teknik provinces (a business coverage area, not the geographic Ege region), all real provinces", () => {
  assert.deepEqual([...EGE_TEKNIK_SERVICE_PROVINCES].sort(), ["Afyonkarahisar", "Aydın", "Balıkesir", "Denizli", "İzmir", "Kütahya", "Manisa", "Muğla", "Uşak"].sort());
  for (const p of EGE_TEKNIK_SERVICE_PROVINCES) assert.ok((TURKEY_PROVINCES as readonly string[]).includes(p), p);
});
test("province input is matched case-, diacritic- and locale-insensitively to the canonical name", () => {
  for (const [input, canonical] of [["izmir", "İzmir"], ["IZMIR", "İzmir"], ["İZMİR", "İzmir"], [" mugla ", "Muğla"], ["USAK", "Uşak"], ["kutahya", "Kütahya"], ["AFYONKARAHISAR", "Afyonkarahisar"], ["balikesir", "Balıkesir"], ["Ankara", "Ankara"], ["sanliurfa", "Şanlıurfa"], ["hakkari", "Hakkari"]] as const) assert.equal(canonicalProvince(input), canonical, input);
  for (const bad of ["", "İzmir/Bornova", "Bornova", "Atlantis", "Aydin Merkez", "Izmr", "Izmirr"]) assert.equal(canonicalProvince(bad), null, `"${bad}" is not a province (no fuzzy matching)`);
});

// ---- the 23-scenario matrix ---------------------------------------------------------------------
test("1-3 one or several air conditioners: dealer delivery, installation included, never any shipping fee", () => {
  for (const classes of [[AC], [AC, AC], [AC, AC, AC]]) {
    const plan = ok(planDelivery({ classes, province: "İzmir" }));
    assert.equal(plan.method, "dealer");
    assert.equal(plan.installationIncluded, true);
    assert.equal(plan.shipping.amount, 0);
  }
});
test("4-5 one or several shippable parts: pickup by default, no installation, no fee", () => {
  for (const classes of [[PART], [PART, PART, PART]]) {
    const plan = ok(planDelivery({ classes, province: "Ankara" }));
    assert.equal(plan.method, "pickup");
    assert.equal(plan.installationIncluded, false);
    assert.equal(plan.shipping.amount, 0);
  }
});
test("6-7 and 10: an air conditioner with parts travels entirely by dealer delivery - the parts never need or get carrier shipping", () => {
  for (const classes of [[AC, PART], [AC, PART, PART], [PART, AC, PART, AC], [AC, HEAVY, PART]]) {
    const plan = ok(planDelivery({ classes, province: "Muğla", tariffs: configuredShipping(600) }));
    assert.equal(plan.method, "dealer");
    assert.equal(plan.shipping.amount, 0, "the shipping fee must not apply to a dealer-delivered order, even with a configured tariff");
    assert.equal(plan.installationIncluded, true);
  }
});
test("6-7: asking for shipping or pickup on a cart with an air conditioner is an invalid delivery method", () => {
  for (const method of ["shipping", "pickup"] as const) assert.equal(err(planDelivery({ classes: [AC, PART], province: "İzmir", method })).code, "INVALID_DELIVERY_METHOD");
  assert.equal(ok(planDelivery({ classes: [AC, PART], province: "İzmir", method: "dealer" })).method, "dealer");
});
test("8 a heavy part that cannot be shipped: dealer delivery only, Ege only, never carrier", () => {
  assert.equal(ok(planDelivery({ classes: [HEAVY], province: "Aydın" })).method, "dealer");
  assert.equal(ok(planDelivery({ classes: [HEAVY], province: "Aydın" })).installationIncluded, false);
  assert.equal(err(planDelivery({ classes: [HEAVY], province: "İzmir", method: "shipping", tariffs: configuredShipping(600) })).code, "INVALID_DELIVERY_METHOD");
  assert.equal(err(planDelivery({ classes: [HEAVY], province: "Ankara" })).code, "SERVICE_AREA_UNAVAILABLE");
});
test("9 second-hand products are not part of the order flow: the route only sells products from the products table", () => {
  assert.doesNotMatch(route, /usedProducts|secondHand|used_products|second_hand/);
  assert.match(route, /eq\(products\.status, "published"\), eq\(products\.saleMode, "online"\)/);
});
test("11 every service-area province is a valid dealer-delivery address", () => {
  for (const province of EGE_TEKNIK_SERVICE_PROVINCES) {
    const plan = ok(planDelivery({ classes: [AC], province }));
    assert.equal(plan.region, "service");
    assert.equal(plan.province, province);
  }
});
test("12 an address outside the service area is refused for dealer delivery, with the exact user message - never silently accepted", () => {
  for (const province of ["Ankara", "İstanbul", "Antalya", "Bursa", "Van", "Çanakkale", "Isparta"]) {
    const e = err(planDelivery({ classes: [AC], province }));
    assert.equal(e.code, "SERVICE_AREA_UNAVAILABLE");
    assert.equal(e.message, SERVICE_AREA_MESSAGE);
    assert.equal(e.status, 422);
    assert.equal(err(planDelivery({ classes: [AC, PART], province })).code, "SERVICE_AREA_UNAVAILABLE", "a mixed cart with an air conditioner is bound to the service area too");
  }
});
test("13 shipping not selected: pickup, and no shipping line or fee exists", () => {
  const plan = ok(planDelivery({ classes: [PART], province: "Ankara", tariffs: configuredShipping(600) }));
  assert.equal(plan.method, "pickup");
  assert.deepEqual(plan.shipping, { amount: 0, vatAmount: 0 });
});
test("14 shipping selected: Turkey-wide, priced by the server (flat fee + its VAT), added to the total once", () => {
  const plan = ok(planDelivery({ classes: [PART, PART], province: "Ankara", method: "shipping", tariffs: configuredShipping(600) }));
  assert.equal(plan.method, "shipping");
  assert.equal(plan.region, "outside");
  assert.deepEqual(plan.shipping, { amount: 600, vatAmount: 100 });
  const products = computeOrderTotals(priceOrderLines([{ id: "p", price: 750, vatRateBps: 2000 }], new Map([["p", 2]])));
  const totals = finalizeOrderTotals(products, plan.shipping);
  assert.equal(totals.total, 1500 + 600);
  assert.equal(totals.shippingTotal, 600);
  assert.equal(totals.installationTotal, 0);
});
test("14 a pending shipping tariff blocks ONLY the shipping choice (fail-closed): pickup and dealer delivery keep working", () => {
  assert.equal(err(planDelivery({ classes: [PART], province: "Ankara", method: "shipping", tariffs: CHECKOUT_TARIFFS })).code, "SHIPPING_UNAVAILABLE");
  assert.equal(ok(planDelivery({ classes: [PART], province: "Ankara", method: "pickup", tariffs: CHECKOUT_TARIFFS })).method, "pickup");
  assert.equal(ok(planDelivery({ classes: [AC], province: "İzmir", tariffs: CHECKOUT_TARIFFS })).method, "dealer");
  assert.equal(ok(planDelivery({ classes: [AC, PART], province: "İzmir", tariffs: CHECKOUT_TARIFFS })).method, "dealer");
  assert.deepEqual(CHECKOUT_TARIFFS, { shipping: { status: "pending" } }, "the tariff stays pending until the operator approves a price");
});
test("15-17 client tampering: shipping fee, product price and VAT fields never survive the request schema", () => {
  const base = { customerName: "Test Kişi", phone: "05000000000", email: "t@example.test", city: "İzmir", address: "Test Mahallesi 1 Sokak", paymentProvider: "discovery", items: [{ productId: "p1", quantity: 1, price: 1, unitPrice: 1, vatRateBps: 0, vatAmount: 0, deliveryClass: "shippable" }], expectedTotal: 1, shippingFee: 0, shippingTotal: 0, installationTotal: 0, vatTotal: 0, subtotal: 0, total: 1, delivery: "pickup" };
  const parsed = orderRequestSchema.safeParse(base);
  assert.equal(parsed.success, true);
  const data = parsed.success ? (parsed.data as unknown as Record<string, unknown>) : {};
  for (const key of ["shippingFee", "shippingTotal", "installationTotal", "vatTotal", "subtotal", "total"]) assert.equal(key in data, false, key);
  const item = (data.items as Record<string, unknown>[])[0]!;
  for (const key of ["price", "unitPrice", "vatRateBps", "vatAmount", "deliveryClass"]) assert.equal(key in item, false, `items[].${key}`);
});
test("16 the price comes from the database row: a ₺50.000 product is charged in full whatever the client claimed", () => {
  const lines = priceOrderLines([{ id: "p", price: 50_000, vatRateBps: 2000 }], new Map([["p", 1]]));
  assert.equal(computeOrderTotals(lines).total, 50_000);
  assert.match(route, /priceOrderLines\(rows\.map\(\(\{ product \}\) => product\), requested\)/);
  assert.match(route, /unitPrice: product\.price/);
});
test("18-19 stock: an out-of-stock quantity cannot be reserved, and the route uses one atomic conditional update", () => {
  assert.deepEqual(reserveUnits({ onHand: 1, reserved: 0 }, 2), { ok: false });
  assert.equal(reserveUnits({ onHand: 2, reserved: 0 }, 2).ok, true);
  assert.match(route, /tx\.update\(inventory\)[\s\S]*onHand: sql`\$\{inventory\.onHand\} - \$\{line\.quantity\}`/);
  assert.match(route, /OUT_OF_STOCK:/);
});
test("20 idempotency: the same request has one fingerprint, a different delivery choice is a different request, and replay is answered before any stock is touched", () => {
  const data = orderRequestSchema.parse({ customerName: "Test Kişi", phone: "05000000000", email: "t@example.test", city: "Ankara", address: "Test Mahallesi 1 Sokak", paymentProvider: "discovery", items: [{ productId: "p1", quantity: 1 }], expectedTotal: 100, delivery: "shipping" });
  const q = new Map([["p1", 1]]);
  assert.equal(orderRequestFingerprint(data, q), orderRequestFingerprint({ ...data }, q));
  assert.notEqual(orderRequestFingerprint(data, q), orderRequestFingerprint({ ...data, delivery: "pickup" }, q));
  assert.ok(route.indexOf("const replayed = await replay()") < route.indexOf("planDelivery("));
  assert.ok(route.indexOf("planDelivery(") < route.indexOf("db.transaction"));
});
test("21-22 an empty cart and an invalid/unsellable product are refused before anything is written", () => {
  assert.equal(orderRequestSchema.safeParse({ customerName: "A B", phone: "0500000000", email: "a@b.test", city: "İzmir", address: "Adres satırı 1", paymentProvider: "discovery", items: [], expectedTotal: 0 }).success, false);
  assert.equal(err(planDelivery({ classes: [], province: "İzmir" })).code, "EMPTY_CART");
  assert.equal(err(planDelivery({ classes: ["not-a-class"], province: "İzmir" })).code, "INVALID_PRODUCT_DELIVERY");
  assert.match(route, /rows\.length !== requested\.size\) return Response\.json\(\{ error: "Sepette satışa açık olmayan bir ürün var\." \}, \{ status: 409 \}\)/);
});
test("23 an invalid delivery method is rejected by the schema and, for the wrong cart, by the plan", () => {
  const base = { customerName: "A B", phone: "0500000000", email: "a@b.test", city: "İzmir", address: "Adres satırı 1", paymentProvider: "discovery", items: [{ productId: "p", quantity: 1 }], expectedTotal: 1 };
  assert.equal(orderRequestSchema.safeParse({ ...base, delivery: "drone" }).success, false);
  assert.equal(err(planDelivery({ classes: [PART], province: "Ankara", method: "dealer" })).code, "INVALID_DELIVERY_METHOD");
});
test("an invalid province is refused for every cart", () => {
  for (const classes of [[AC], [PART]]) assert.equal(err(planDelivery({ classes, province: "Bornova" })).code, "INVALID_PROVINCE");
});

// ---- snapshots ----------------------------------------------------------------------------------
test("the order snapshots record the delivery class, installation, shipping eligibility, method, region, province and district", () => {
  assert.match(route, /deliveryClass: product\.deliveryClass, installationIncluded: deliveryTraits\(/);
  assert.match(route, /shippingEligible: deliveryTraits\(/);
  assert.match(route, /delivery: \{ method: plan\.method, region: plan\.region, shippingFee: shippingTotal, installationIncluded: plan\.installationIncluded \}/);
  assert.match(route, /city: plan\.province, district: plan\.district/, "the CANONICAL province and district are stored, not the raw input");
});

// ---- catalog seed -------------------------------------------------------------------------------
test("the seeded catalog marks exactly the spare parts shippable; every other product is dealer-delivered with installation", () => {
  const shippable = catalogDefaults.filter((p) => p.deliveryClass === "shippable").map((p) => p.id).sort();
  assert.deepEqual(shippable, ["hava-temizleme-cihazi-filtresi", "multi-fonksiyonel-filtre", "wifi-kiti-aphro-18000-24000-72", "wifi-kiti-aphro-64-1"]);
  assert.ok(catalogDefaults.filter((p) => p.deliveryClass !== "shippable").every((p) => p.deliveryClass === "installed_delivery"));
});

// ---- migration 0012 ------------------------------------------------------------------------------
const sql = read("drizzle-pg/0012_delivery_class.sql");
test("migration 0012 adds one NOT NULL column defaulting to installed_delivery, constrained to the three classes", () => {
  assert.match(sql, /ALTER TABLE "products" ADD COLUMN "delivery_class" text DEFAULT 'installed_delivery' NOT NULL/);
  assert.match(sql, /CONSTRAINT "products_delivery_class_ck" CHECK \("products"\."delivery_class" IN \('installed_delivery','shippable','local_delivery'\)\)/);
});
test("migration 0012 backfills the spare parts deterministically, by their stable category id only", () => {
  assert.match(sql, /UPDATE "products" SET "delivery_class" = 'shippable' WHERE "category_id" = 'category-yedek-parca';/);
  assert.equal((sql.match(/UPDATE /g) ?? []).length, 1, "exactly one data statement");
  assert.doesNotMatch(sql, /\bname\b\s*(I?LIKE|=)|"category"\s*(I?LIKE|=)|\bLIKE\b|~/i, "never matched on a display name or label");
});
test("migration 0012 is additive: nothing is dropped, deleted or rewritten", () => {
  assert.doesNotMatch(sql, /\bDROP\b|\bDELETE\b|\bTRUNCATE\b|ALTER COLUMN|RENAME/i);
  assert.equal((sql.match(/ALTER TABLE/g) ?? []).length, 2);
});
test("migration 0012 is registered in the journal as idx 12 after 0011, and the schema declares the same column and check", () => {
  const journal = JSON.parse(read("drizzle-pg/meta/_journal.json")) as { entries: { idx: number; tag: string }[] };
  assert.deepEqual(journal.entries.slice(-2).map((e) => [e.idx, e.tag]), [[11, "0011_admin_governance"], [12, "0012_delivery_class"]]);
  const schema = read("db/schema.ts");
  assert.match(schema, /deliveryClass:text\("delivery_class"\)\.notNull\(\)\.default\("installed_delivery"\)/);
  assert.match(schema, /check\("products_delivery_class_ck",sql`\$\{t\.deliveryClass\} IN \('installed_delivery','shippable','local_delivery'\)`\)/);
  const snapshot = JSON.parse(read("drizzle-pg/meta/0012_snapshot.json")) as { tables: Record<string, { columns: Record<string, { default?: string; notNull: boolean }> }> };
  assert.deepEqual(snapshot.tables["public.products"]!.columns.delivery_class, { name: "delivery_class", type: "text", primaryKey: false, notNull: true, default: "'installed_delivery'" });
});
test("migration 0012 touches nothing else: the index migration that was dropped is not back", () => {
  assert.equal(readFileSync(new URL("../drizzle-pg/0012_delivery_class.sql", import.meta.url), "utf8").includes("orders_created_idx"), false);
});

// ---- public config + legal drafts ------------------------------------------------------------------
test("the public checkout config exposes the shipping tariff, the service provinces and the one location dataset, nothing internal", () => {
  const cfg = read("app/api/checkout/charges/route.ts");
  assert.match(cfg, /publicTariffs\(\), serviceProvinces: EGE_TEKNIK_SERVICE_PROVINCES, locations: DISTRICTS_BY_PROVINCE, deliveryTraits: publicDeliveryTraits/);
  assert.doesNotMatch(cfg, /deliveryClass|planDelivery|DATABASE/);
});
test("the checkout legal drafts describe the new model as a TECHNICAL draft and never claim legal approval", () => {
  for (const file of ["distance-sales", "pre-information", "installation", "delivery-returns"]) {
    const md = read(`docs/legal-drafts/${file}.md`);
    assert.match(md, /NOT PUBLISHED/, `${file} stays unpublished`);
    assert.doesNotMatch(md, /hukuken onaylan(dı|mıştır)|hukuki onay(ı)? (alındı|verildi)|onaylı metin/i, `${file} must not claim approval`);
  }
  const sales = read("docs/legal-drafts/distance-sales.md");
  assert.match(sales, /TEKNİK TASLAK GÜNCELLEMESİ[\s\S]*HUKUKİ İNCELEME VE ONAY YAPILMAMIŞTIR/);
  assert.match(sales, /standart\s+montaj hizmetinin sunulmasıdır/);
  assert.match(sales, /kargo değildir/, "delivery included in the price is not called shipping");
  assert.doesNotMatch(sales, /ücretsiz (kargo|montaj)|bedava/i);
  assert.match(sales, /\[DOĞRULAMA BEKLİYOR: standart montaj paketi kapsamı\]/, "the unverified package scope stays flagged");
});
