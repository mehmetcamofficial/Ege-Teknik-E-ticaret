import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CHECKOUT_TARIFFS, finalizeOrderTotals, priceCharges, publicTariffs, totalMatchesDisplayed, type CheckoutTariffs } from "../lib/checkout-charges.ts";
import { CHECKOUT_NOTICE_SLUGS, missingNoticeSlugs } from "../lib/legal.ts";
import { computeOrderTotals, marketingChannels, orderRequestFingerprint, orderRequestSchema, priceOrderLines } from "../lib/order-domain.ts";

const route = readFileSync("app/api/orders/route.ts", "utf8");
const html = readFileSync("public/checkout.html", "utf8");
const store = readFileSync("public/store.js", "utf8");
const migration = readFileSync("drizzle-pg/0006_checkout_charges_and_marketing_consents.sql", "utf8");
const configured = (delivery: number | null, installation: number | null): CheckoutTariffs => ({
  delivery: delivery === null ? { status: "pending" } : { status: "configured", amount: delivery, vatRateBps: 2000 },
  installation: installation === null ? { status: "pending" } : { status: "configured", amount: installation, vatRateBps: 2000 },
});
const base = { customerName: "Test Kişi", phone: "05000000000", email: "test@example.test", city: "İzmir", address: "Test Mahallesi 1 Sokak No 1", paymentProvider: "discovery" as const, items: [{ productId: "p1", quantity: 1 }], expectedTotal: 1000 };
const parse = (extra: Record<string, unknown> = {}) => { const r = orderRequestSchema.safeParse({ ...base, ...extra }); assert.equal(r.success, true); return r.success ? r.data : (undefined as never); };
const fp = (extra: Record<string, unknown> = {}) => { const d = parse(extra); return orderRequestFingerprint(d, new Map(d.items.map((i) => [i.productId, i.quantity]))); };

// ---- charge model -------------------------------------------------------------------------------
test("no approved tariff is invented: every shipped tariff is pending", () => {
  assert.deepEqual(CHECKOUT_TARIFFS, { delivery: { status: "pending" }, installation: { status: "pending" } });
  assert.deepEqual(publicTariffs(), { delivery: { status: "pending" }, installation: { status: "pending" } });
});
test("unknown mandatory shipping charge blocks the order (fail-closed), with or without installation", () => {
  assert.deepEqual(priceCharges("delivery_only", configured(null, 100)), { ok: false, undetermined: ["delivery"] });
  assert.deepEqual(priceCharges("survey_then_install", configured(null, 100)), { ok: false, undetermined: ["delivery"] });
});
test("unknown installation charge blocks only when installation is selected", () => {
  assert.deepEqual(priceCharges("survey_then_install", configured(500, null)), { ok: false, undetermined: ["installation"] });
  assert.equal(priceCharges("delivery_only", configured(500, null)).ok, true);
  assert.deepEqual(priceCharges("survey_then_install", configured(null, null)), { ok: false, undetermined: ["delivery", "installation"] });
});
test("malformed tariffs are treated as undetermined, never as zero", () => {
  const bad = (amount: unknown): CheckoutTariffs => ({ delivery: { status: "configured", amount: amount as number, vatRateBps: 2000 }, installation: { status: "pending" } });
  for (const amount of [-1, 1.5, NaN, "500", undefined]) assert.equal(priceCharges("delivery_only", bad(amount)).ok, false, String(amount));
  assert.equal(priceCharges("delivery_only", { delivery: { status: "configured", amount: 500, vatRateBps: 99_999 }, installation: { status: "pending" } }).ok, false);
});
test("known charges are added to the total; a configured zero is genuinely free", () => {
  const withInstall = priceCharges("survey_then_install", configured(500, 1200));
  assert.ok(withInstall.ok);
  assert.equal(withInstall.chargesTotal, 1700);
  const free = priceCharges("delivery_only", configured(0, null));
  assert.ok(free.ok && free.chargesTotal === 0);
  const products = computeOrderTotals(priceOrderLines([{ id: "p", price: 12_000, vatRateBps: 2000 }], new Map([["p", 1]])));
  const totals = finalizeOrderTotals(products, withInstall);
  assert.equal(totals.total, 12_000 + 1700);
  assert.equal(totals.shippingTotal, 500);
  assert.equal(totals.installationTotal, 1200);
  assert.equal(totals.subtotal, totals.total - totals.vatTotal);
});
test("installation is not added when the customer did not choose it", () => {
  const r = priceCharges("delivery_only", configured(500, 1200));
  assert.ok(r.ok && r.installation.amount === 0 && r.chargesTotal === 500);
});
test("the displayed total is only a guard: a mismatch is refused", () => {
  assert.equal(totalMatchesDisplayed(13_700, 13_700), true);
  assert.equal(totalMatchesDisplayed(13_700, 12_000), false);
  assert.equal(totalMatchesDisplayed(13_700, 13_700.5), false);
});

// ---- server authority / tampering ----------------------------------------------------------------
test("client shipping/installation/tax/total fields are stripped and never reach the parsed request", () => {
  const parsed = parse({ shipping: 0, shippingTotal: 0, shippingAmount: 0, installationAmount: 0, installationPrice: 0, tax: 0, vatTotal: 0, subtotal: 1, total: 1, price: 1 }) as Record<string, unknown>;
  for (const key of ["shipping", "shippingTotal", "shippingAmount", "installationAmount", "installationPrice", "tax", "vatTotal", "subtotal", "total", "price"]) assert.equal(key in parsed, false, key);
});
test("the order route takes every amount from the server computation", () => {
  assert.match(route, /priceCharges\(parsed\.data\.installation\)/);
  assert.match(route, /finalizeOrderTotals\(computeOrderTotals\(lines\), charges\)/);
  assert.match(route, /shippingTotal, installationTotal, total/);
  assert.doesNotMatch(route, /parsed\.data\.(shipping|installationAmount|total|subtotal)/);
  assert.match(route, /totalMatchesDisplayed\(total, parsed\.data\.expectedTotal\)/);
});
test("every compliance refusal happens before the transaction (no order, no stock, no acceptance)", () => {
  const tx = route.indexOf("db.transaction");
  for (const code of ["LEGAL_DOCUMENTS_UNAVAILABLE", "acceptance.ok", "LEGAL_NOTICE_UNAVAILABLE", "CHARGES_UNDETERMINED", "PRICE_CHANGED"]) {
    const at = route.indexOf(code);
    assert.ok(at > 0 && at < tx, `${code} must be checked before the transaction`);
  }
  assert.ok(route.indexOf("CHARGES_UNDETERMINED") < route.indexOf("tx.update(inventory)"), "charge check precedes inventory changes");
});
test("expectedTotal is required by the request schema", () => {
  const withoutTotal: Record<string, unknown> = { ...base };
  delete withoutTotal.expectedTotal;
  assert.equal(orderRequestSchema.safeParse(withoutTotal).success, false);
  assert.equal(orderRequestSchema.safeParse({ ...base, expectedTotal: -1 }).success, false);
  assert.equal(orderRequestSchema.safeParse({ ...base, expectedTotal: 10.5 }).success, false);
});

// ---- installation is optional and never pre-selected ---------------------------------------------
test("installation defaults to none in the server schema and the checkout markup", () => {
  assert.equal(parse().installation, "delivery_only");
  assert.match(html, /<option value="delivery_only" selected>/);
  assert.doesNotMatch(html, /<option value="survey_then_install" selected>/);
  assert.match(store, /installation:fields\.installation\|\|'delivery_only'/);
});

// ---- marketing -----------------------------------------------------------------------------------
test("marketing defaults to all-off and only explicit true counts", () => {
  assert.deepEqual(parse().marketing, { sms: false, email: false, whatsapp: false });
  assert.deepEqual(marketingChannels(parse().marketing), []);
  assert.deepEqual(marketingChannels(parse({ marketing: { email: true } }).marketing), ["email"]);
  assert.deepEqual(marketingChannels(parse({ marketing: { sms: true, whatsapp: true, email: true } }).marketing), ["sms", "email", "whatsapp"]);
  assert.equal(orderRequestSchema.safeParse({ ...base, marketing: { sms: "yes" } }).success, false);
  assert.deepEqual(marketingChannels(parse({ marketing: { sms: false } }).marketing), []);
});
test("a different marketing choice is a different request (idempotency conflict); none is valid", () => {
  assert.notEqual(fp({ marketing: { sms: true } }), fp());
  assert.notEqual(fp({ marketing: { sms: true } }), fp({ marketing: { email: true } }));
  assert.equal(fp({ marketing: { sms: false, email: false, whatsapp: false } }), fp());
});
test("marketing permission rows are written only for ticked channels, in the same transaction, after the customer exists", () => {
  const tx = route.slice(route.indexOf("db.transaction"));
  assert.match(tx, /if \(channels\.length\) await tx\.insert\(marketingConsents\)/);
  assert.ok(tx.indexOf("tx.insert(customers)") < tx.indexOf("tx.insert(marketingConsents)"));
  assert.match(tx, /granted: true/);
});
test("checkout markup: three separate, unchecked, optional marketing boxes outside the legal block", () => {
  const legal = html.match(/<fieldset[^>]*data-legal-consents[^>]*>[\s\S]*?<\/fieldset>/)![0];
  assert.doesNotMatch(legal, /marketing/i);
  const marketing = html.match(/<fieldset[^>]*data-marketing-consents[^>]*>[\s\S]*?<\/fieldset>/)![0];
  const inputs = [...marketing.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);
  assert.equal(inputs.length, 3);
  for (const input of inputs) assert.doesNotMatch(input, /\bchecked\b|\brequired\b/);
  assert.match(marketing, /isteğe bağlı/i);
  assert.match(marketing, /gerekli değildir/i);
});
test("the client sends only explicitly ticked marketing channels", () => {
  assert.match(store, /function marketingChoices\(boxes\)\{const choices=\{sms:false,email:false,whatsapp:false\}/);
  assert.match(store, /marketing:marketingChoices\(f\.querySelectorAll\('\[data-marketing-channel\]'\)\)/);
});
test("migration 0006 is additive: a new table, one defaulted column, no destructive or data SQL", () => {
  assert.match(migration, /CREATE TABLE "marketing_consents"/);
  assert.match(migration, /ADD COLUMN "installation_total" integer DEFAULT 0 NOT NULL/);
  assert.match(migration, /CHECK \("marketing_consents"\."channel" IN \('sms','email','whatsapp'\)\)/);
  for (const kw of ["DROP", "TRUNCATE", "DELETE", "UPDATE", "INSERT", "RENAME"]) assert.doesNotMatch(migration.replace(/ON DELETE no action ON UPDATE no action/g, ""), new RegExp(`\\b${kw}\\b`, "i"), kw);
  assert.doesNotMatch(migration, /ALTER TABLE "(customers|order_legal_acceptances|legal_document_versions)"/, "only orders is altered");
});

// ---- KVKK ----------------------------------------------------------------------------------------
test("the KVKK notice is informational: never a checkbox, and its absence blocks orders", () => {
  assert.deepEqual([...CHECKOUT_NOTICE_SLUGS], ["kvkk"]);
  assert.deepEqual(missingNoticeSlugs(["distance-sales", "pre-information"]), ["kvkk"]);
  assert.deepEqual(missingNoticeSlugs(["kvkk"]), []);
  assert.match(html, /data-kvkk-notice/);
  assert.doesNotMatch(html.match(/<p[^>]*data-kvkk-notice[^>]*>/)![0], /checkbox/);
  assert.match(route, /LEGAL_NOTICE_UNAVAILABLE/);
  assert.match(store, /KVKK Aydınlatma Metni<\/a>'ni inceleyebilirsiniz/);
  assert.match(store, /KVKK Aydınlatma Metni henüz yayınlanmamıştır/);
  assert.match(readFileSync("public/contact.html", "utf8"), /data-kvkk-notice/);
});
test("/api/legal/required is unchanged: exactly the two acceptance documents, no notices", () => {
  assert.doesNotMatch(readFileSync("app/api/legal/required/route.ts", "utf8"), /kvkk|notice/i);
});

// ---- payment methods -----------------------------------------------------------------------------
test("bank transfer is shown as unavailable with no account details; PayTR stays disabled", () => {
  const radios = [...html.matchAll(/<input\b[^>]*name="provider"[^>]*>/g)].map((m) => m[0]);
  assert.match(radios.find((r) => /bank_transfer/.test(r))!, /\sdisabled\b/);
  assert.match(radios.find((r) => /PayTR/.test(r))!, /\sdisabled\b/);
  assert.doesNotMatch(html, /\bTR\d{2}[ 0-9]{10,}|IBAN\s*:/i);
  assert.match(html, /Yapılandırma bekleniyor/);
});

// ---- checkout page copy --------------------------------------------------------------------------
test("the misleading 'Keşifte netleşir' total row is gone; the summary shows a final payable total or blocks", () => {
  assert.doesNotMatch(html, /Keşifte netleşir|sipariş sonrası sizinle teyit/);
  assert.match(html, /data-charge-summary/);
  assert.match(html, /Ödenecek toplam \(KDV dâhil\)/);
  assert.match(html, /Siparişi Onayla — ödeme yükümlülüğü doğurur/);
  assert.match(store, /summary\.total===null\?'Kesinleşmedi'/);
  assert.match(store, /if\(submit\)submit\.disabled=summary\.total===null\|\|!hasItems/);
});

// ---- Phase 5B: guest checkout is the only path, and confirmation exposes no internal id -----------
test("checkout never requires an account: no sign-in/register control on the page, and guest checkout is stated explicitly", () => {
  assert.doesNotMatch(html, /sign[\s-]?in|giriş yap|kayıt ol|hesap oluşturun ve devam/i);
  assert.match(html, /Hesap oluşturmadan, misafir olarak sipariş verebilirsiniz/);
});
test("the post-order account offer is optional, non-blocking and never claims the guest order will appear in it", () => {
  assert.match(html, /data-confirmation-account/);
  assert.match(html, /isteğe bağlıdır ve siparişinizi etkilemez/);
  // The one honest claim it may make is that the account link exists - never that THIS order is now in it.
  assert.doesNotMatch(html, /bu sipariş(i|inizi)? hesabınız(da|a)/i);
  assert.match(html, /bu misafir siparişi hesabınıza otomatik eklenmez/);
});
test("both the just-created and the idempotent-replay response are built by the same allow-list function", () => {
  const matches = [...route.matchAll(/toOrderConfirmation\(/g)];
  assert.equal(matches.length, 2, "toOrderConfirmation must be called exactly twice: create and replay");
});
test("neither order response ever inlines an internal id: only the allow-list helpers construct the JSON body", () => {
  for (const forbidden of [/Response\.json\(\{[^}]*\bid:\s*(id|existing\.id)\b/, /Response\.json\(\{[^}]*\bcustomerId\b/, /Response\.json\(\{[^}]*\baddressId\b/, /Response\.json\(\{[^}]*idempotencyKey:\s*key\b/]) assert.doesNotMatch(route, forbidden);
});
test("the idempotency key is claimed before inventory is ever touched - a concurrent duplicate can never reserve stock twice", () => {
  const claim = route.indexOf("onConflictDoNothing({ target: orders.idempotencyKey })");
  const throwReplay = route.indexOf("throw new IdempotentReplay()");
  const inventoryUpdate = route.indexOf("tx.update(inventory)");
  assert.ok(claim > 0 && throwReplay > claim && throwReplay < inventoryUpdate, "claim -> replay-check -> inventory, in that order");
});
test("the inventory guard is an atomic conditional UPDATE (on_hand >= quantity), not a separate read-then-write", () => {
  assert.match(route, /tx\.update\(inventory\)\.set\(\{[^}]*onHand:\s*sql`\$\{inventory\.onHand\}\s*-\s*\$\{line\.quantity\}`/);
  assert.match(route, /gte\(inventory\.onHand,\s*line\.quantity\)/);
  assert.match(route, /if\s*\(!changed\.length\)\s*throw new Error\(`OUT_OF_STOCK/);
});
test("a replayed request never re-touches inventory: replay() only selects, it has no insert/update/delete", () => {
  const replayFn = route.slice(route.indexOf("const replay = async"), route.indexOf("const replayed = await replay()"));
  assert.doesNotMatch(replayFn, /tx\.|\.insert\(|\.update\(|\.delete\(/);
});
