import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CHECKOUT_LEGAL_SLUGS, checkLegalAcceptance, selectRequiredLegalVersions, type LegalVersionRow } from "../lib/legal.ts";
import { computeOrderTotals, orderRequestFingerprint, orderRequestSchema, priceOrderLines } from "../lib/order-domain.ts";

const NOW = new Date("2026-09-25T12:00:00Z");
const past = new Date("2026-09-01T00:00:00Z");
const future = new Date("2026-10-01T00:00:00Z");
const row = (over: Partial<LegalVersionRow>): LegalVersionRow => ({ id: "v", slug: "distance-sales", version: 1, title: "PREVIEW TEST", effectiveAt: past, publishedAt: past, ...over });
const published: LegalVersionRow[] = [row({ id: "ds-1", slug: "distance-sales" }), row({ id: "pi-1", slug: "pre-information" })];
const base = { customerName: "Test Kişi", phone: "05000000000", email: "test@example.test", city: "İzmir", address: "Test Mahallesi 1 Sokak No 1", paymentProvider: "discovery" as const, items: [{ productId: "p1", quantity: 1 }], expectedTotal: 1000 };
const parse = (extra: Record<string, unknown> = {}) => { const r = orderRequestSchema.safeParse({ ...base, ...extra }); assert.equal(r.success, true); return r.success ? r.data : (undefined as never); };
const fp = (extra: Record<string, unknown> = {}) => { const d = parse(extra); return orderRequestFingerprint(d, new Map(d.items.map((i) => [i.productId, i.quantity]))); };
const required = (rows = published) => { const r = selectRequiredLegalVersions(rows, NOW); assert.equal(r.ok, true); return r.ok ? r.required : []; };

// ---- legal enforcement ----
test("the required checkout slugs are distance-sales and pre-information", () => assert.deepEqual([...CHECKOUT_LEGAL_SLUGS], ["distance-sales", "pre-information"]));

test("missing required acceptance is rejected", () => {
  assert.deepEqual(checkLegalAcceptance(required(), []), { ok: false, code: "LEGAL_ACCEPTANCE_REQUIRED" });
  assert.deepEqual(checkLegalAcceptance(required(), ["ds-1"]), { ok: false, code: "LEGAL_ACCEPTANCE_REQUIRED" });
});

test("a stale version is rejected once a newer one is current", () => {
  const rows = [...published, row({ id: "ds-2", slug: "distance-sales", version: 2 })];
  assert.deepEqual(required(rows).map((v) => v.versionId), ["ds-2", "pi-1"]);
  assert.deepEqual(checkLegalAcceptance(required(rows), ["ds-1", "pi-1"]), { ok: false, code: "LEGAL_VERSION_MISMATCH" });
});

test("an unpublished (future published/effective) version cannot satisfy checkout", () => {
  assert.equal(selectRequiredLegalVersions([published[0], row({ id: "pi-1", slug: "pre-information", publishedAt: future })], NOW).ok, false);
  assert.equal(selectRequiredLegalVersions([published[0], row({ id: "pi-1", slug: "pre-information", effectiveAt: future })], NOW).ok, false);
  const rows = [...published, row({ id: "ds-2", slug: "distance-sales", version: 2, publishedAt: future })];
  assert.deepEqual(required(rows).map((v) => v.versionId), ["ds-1", "pi-1"], "a future version must not displace the current one");
  assert.deepEqual(checkLegalAcceptance(required(rows), ["ds-2", "pi-1"]), { ok: false, code: "LEGAL_VERSION_MISMATCH" });
});

test("a missing required document makes checkout unavailable (fail closed)", () => {
  const result = selectRequiredLegalVersions([published[0]], NOW);
  assert.deepEqual(result, { ok: false, missing: ["pre-information"] });
  assert.equal(selectRequiredLegalVersions([], NOW).ok, false);
});

test("nonexistent, unrelated or extra version ids are rejected", () => {
  assert.equal(checkLegalAcceptance(required(), ["nope", "pi-1"]).ok, false);
  assert.deepEqual(checkLegalAcceptance(required(), ["ds-1", "pi-1", "other-doc-1"]), { ok: false, code: "LEGAL_VERSION_MISMATCH" });
});

test("all required current versions accepted is allowed, in any order", () => {
  assert.deepEqual(checkLegalAcceptance(required(), ["ds-1", "pi-1"]), { ok: true });
  assert.deepEqual(checkLegalAcceptance(required(), ["pi-1", "ds-1"]), { ok: true });
});

test("duplicate acceptance ids fail request validation", () => {
  assert.equal(orderRequestSchema.safeParse({ ...base, legalAcceptances: ["ds-1", "ds-1"] }).success, false);
});

test("legalAcceptances defaults to empty, so an omitted field is a missing acceptance, not a pass", () => {
  assert.deepEqual(parse().legalAcceptances, []);
  assert.equal(checkLegalAcceptance(required(), parse().legalAcceptances).ok, false);
});

test("accepted_at is server-generated: the request schema drops a client-supplied value", () => {
  const data = parse({ acceptedAt: "1999-01-01T00:00:00Z", accepted_at: "1999-01-01T00:00:00Z", legalAcceptances: ["ds-1", "pi-1"] });
  assert.equal("acceptedAt" in data || "accepted_at" in data, false);
  const route = readFileSync("app/api/orders/route.ts", "utf8");
  assert.match(route, /const acceptedAt = new Date\(\);/);
  assert.doesNotMatch(route, /parsed\.data\.acceptedAt/);
});

// ---- atomicity (structure; the runtime behaviour is exercised against Preview in the integration step) ----
const route = readFileSync("app/api/orders/route.ts", "utf8");
const txStart = route.indexOf("db.transaction(");
const txBody = route.slice(txStart, route.indexOf("} catch (error)"));

test("order, items, inventory and legal acceptances are written inside ONE transaction", () => {
  for (const write of ["insert(customers)", "insert(addresses)", "insert(orders)", "update(inventory)", "insert(orderItems)", "insert(orderLegalAcceptances)"]) {
    assert.ok(txBody.includes(`tx.${write}`), `tx.${write} must be inside the transaction`);
  }
  const before = route.slice(0, txStart);
  assert.doesNotMatch(before, /\.(insert|update|delete)\(/, "no write may happen outside the transaction");
  assert.equal(route.match(/db\.transaction\(/g)?.length, 1, "exactly one transaction");
});

test("legal acceptances are inserted last, after the order and its items (any failure rolls all back)", () => {
  assert.ok(txBody.indexOf("insert(orders)") < txBody.indexOf("insert(orderItems)"));
  assert.ok(txBody.indexOf("insert(orderItems)") < txBody.indexOf("insert(orderLegalAcceptances)"));
});

test("acceptance rows reference the server-selected version ids, not client input", () => {
  assert.match(txBody, /legal\.required\.map\(\(version\) => \(\{[^}]*documentVersionId: version\.versionId/);
  assert.doesNotMatch(txBody, /parsed\.data\.legalAcceptances/);
});

// ---- pricing authority ----
test("client price and total manipulation cannot change the authoritative price", () => {
  const data = parse({ price: 1, total: 1, subtotal: 1, unitPrice: 1, items: [{ productId: "p1", quantity: 2, price: 1 }] });
  for (const forbidden of ["price", "total", "subtotal", "unitPrice"]) assert.equal(forbidden in data, false);
  assert.equal("price" in data.items[0], false);
  const lines = priceOrderLines([{ id: "p1", price: 10_000, vatRateBps: 2000 }], new Map([["p1", 2]]));
  assert.equal(computeOrderTotals(lines).total, 20_000);
  assert.equal(fp({ price: 1, total: 1 }), fp(), "client price fields must not enter the fingerprint");
});

// ---- idempotency fingerprint ----
test("same semantic payload => same fingerprint, regardless of item/acceptance order and extra fields", () => {
  const a = fp({ items: [{ productId: "a", quantity: 1 }, { productId: "b", quantity: 2 }], legalAcceptances: ["ds-1", "pi-1"] });
  const b = fp({ items: [{ productId: "b", quantity: 2 }, { productId: "a", quantity: 1 }], legalAcceptances: ["pi-1", "ds-1"], acceptedAt: "x" });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("changed quantity / product / customer data / payment provider => different fingerprint", () => {
  const original = fp();
  assert.notEqual(fp({ items: [{ productId: "p1", quantity: 2 }] }), original);
  assert.notEqual(fp({ items: [{ productId: "p2", quantity: 1 }] }), original);
  assert.notEqual(fp({ city: "Aydın" }), original);
  assert.notEqual(fp({ customerName: "Başka Kişi" }), original);
  assert.notEqual(fp({ address: "Başka Mahallesi 2 Sokak No 2" }), original);
  assert.notEqual(fp({ paymentProvider: "PayTR" }), original);
});

test("changed installation preference or note => different fingerprint", () => {
  assert.notEqual(fp({ note: "Zile basmayın" }), fp());
  assert.notEqual(fp({ installation: "survey_then_install" }), fp());
});

test("changed legal acceptance version => different fingerprint", () => {
  assert.notEqual(fp({ legalAcceptances: ["ds-1", "pi-1"] }), fp({ legalAcceptances: ["ds-2", "pi-1"] }));
  assert.notEqual(fp({ legalAcceptances: ["ds-1", "pi-1"] }), fp());
});

test("whitespace-only differences normalize to the same fingerprint", () => {
  assert.equal(fp({ customerName: "  Test Kişi  ", note: "  " }), fp());
});

// ---- duplicate-race protection (DB-level) ----
test("a unique index on orders.idempotency_key exists and the insert claims it with ON CONFLICT DO NOTHING", () => {
  assert.match(readFileSync("db/schema.ts", "utf8"), /uniqueIndex\("orders_idempotency_uq"\)\.on\(t\.idempotencyKey\)/);
  assert.match(readFileSync("drizzle-pg/0000_black_tarot.sql", "utf8"), /CREATE UNIQUE INDEX "orders_idempotency_uq"/);
  assert.match(txBody, /insert\(orders\)[\s\S]*\.onConflictDoNothing\(\{ target: orders\.idempotencyKey \}\)\.returning/);
});

test("the idempotency key is claimed before inventory is touched, so a duplicate never reserves stock", () => {
  assert.ok(txBody.indexOf("onConflictDoNothing") < txBody.indexOf("update(inventory)"));
  assert.ok(txBody.indexOf("throw new IdempotentReplay()") < txBody.indexOf("update(inventory)"));
});

test("a same-key request is compared by fingerprint: replay returns the original, a different request conflicts", () => {
  assert.match(route, /existing\.requestFingerprint !== fingerprint\) return Response\.json\([^)]*IDEMPOTENCY_KEY_REUSED[^)]*\{ status: 409 \}/);
  assert.match(route, /catch \(error\) \{ if \(error instanceof IdempotentReplay\) return \(await replay\(\)\)/);
});

// ---- installation note ----
test("a valid note is accepted and an oversized note is rejected", () => {
  assert.equal(parse({ note: "Kapıcıya bırakın" }).note, "Kapıcıya bırakın");
  assert.equal(orderRequestSchema.safeParse({ ...base, note: "x".repeat(501) }).success, false);
  assert.equal(orderRequestSchema.safeParse({ ...base, note: "x".repeat(500) }).success, true);
});

test("notes are trimmed and control characters are stripped", () => {
  assert.equal(parse({ note: "  a\u0000b\u0007c\td  " }).note, "abc\td");
  assert.equal(parse().note, "");
});

test("an unknown installation preference is rejected and installation is NOT pre-selected (default delivery_only)", () => {
  assert.equal(orderRequestSchema.safeParse({ ...base, installation: "whatever" }).success, false);
  assert.equal(parse().installation, "delivery_only");
});

test("the note and installation preference are persisted on the order", () => {
  assert.match(txBody, /installationPreference: parsed\.data\.installation, notes: parsed\.data\.note/);
});

// ---- migration 0004 ----
test("migration 0004 is additive: only nullable ADD COLUMN, no destructive or data SQL", () => {
  const sql = readFileSync("drizzle-pg/0004_order_fingerprint_installation.sql", "utf8");
  assert.match(sql, /ALTER TABLE "orders" ADD COLUMN "request_fingerprint" text;/);
  assert.match(sql, /ALTER TABLE "orders" ADD COLUMN "installation_preference" text;/);
  assert.doesNotMatch(sql, /NOT NULL|DEFAULT/i, "new columns must be nullable without defaults (no table rewrite)");
  for (const keyword of ["DROP", "TRUNCATE", "DELETE", "UPDATE", "INSERT", "RENAME", "ALTER COLUMN"]) assert.doesNotMatch(sql, new RegExp(`\\b${keyword}\\b`, "i"));
});

// ---- checkout UI ----
const html = readFileSync("public/checkout.html", "utf8");
test("checkout.html has a legal consent container and never pre-checks anything", () => {
  assert.match(html, /data-legal-consents/);
  assert.doesNotMatch(html, /type="checkbox"[^>]*\bchecked\b/i);
  const storeJs = readFileSync("public/store.js", "utf8");
  const template = storeJs.slice(storeJs.indexOf("function renderLegalConsents"), storeJs.indexOf("function acceptedLegalVersionIds"));
  assert.match(template, /type="checkbox"/);
  assert.doesNotMatch(template, /\bchecked\b/, "generated checkboxes must be unchecked by default");
});

test("optional marketing consent is separate from the legal acceptance UI, unchecked and not required", () => {
  const legalFieldset = html.match(/<fieldset[^>]*data-legal-consents[^>]*>[\s\S]*?<\/fieldset>/)![0];
  assert.doesNotMatch(legalFieldset, /marketing|pazarlama|tanıtım/i, "marketing lives outside the mandatory legal block");
  const marketing = html.match(/<fieldset[^>]*data-marketing-consents[^>]*>[\s\S]*?<\/fieldset>/)![0];
  const boxes = [...marketing.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);
  assert.deepEqual(boxes.map((b) => b.match(/data-marketing-channel="(\w+)"/)![1]), ["sms", "email", "whatsapp"]);
  for (const box of boxes) { assert.doesNotMatch(box, /\bchecked\b|\brequired\b/); assert.match(box, /type="checkbox"/); }
  assert.doesNotMatch(html, /hepsini kabul|accept all/i);
});
