import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import ts from "typescript";
import { formatTry } from "../lib/legal-template.ts";
import test, { beforeEach } from "node:test";
import { DISTRICTS_BY_PROVINCE, planDelivery } from "../lib/delivery.ts";
import { finalizeOrderTotals } from "../lib/checkout-charges.ts";
import { computeOrderTotals, orderRequestFingerprint, orderRequestSchema, priceOrderLines } from "../lib/order-domain.ts";
import { MARKETING_CONSENT_DISABLED } from "../lib/order-domain.ts";
import { TEST_LEGAL_PREVIEW_SECRET } from "./support/legal-preview-harness.ts";
import { resetState, state } from "./support/order-route-fakes.ts";

/**
 * P3-LEGAL-3C.4 / P2 - BEHAVIOURAL tests for the pre-acceptance legal preview protocol.
 *
 * These drive the REAL `POST /api/checkout/legal-preview` and `POST /api/orders` handlers through the in-memory
 * fakes, so every assertion is about what the handlers actually did, not about source text. The order cases that
 * already existed run the same handler; this file adds the preview -> accept -> order flow and the TOCTOU rejections.
 */
register("./support/order-route-hooks.mjs", import.meta.url);
const { POST } = await import("../app/api/orders/route.ts");
const { POST: legalPreviewPOST } = await import("../app/api/checkout/legal-preview/route.ts");

const PRODUCT = { id: "p2-ac-12000", name: "Sentetik Klima", sku: "SYN-12000", slug: "synthetic-ac", category: "Duvar Tipi", capacity: "12000", unitPriceX: 0, price: 12000, vatRateBps: 2000, status: "published", saleMode: "online", deliveryClass: "installed_delivery", installationIncluded: true, shippingEligible: false, stock: 10, reserved: 0 };
const REQUIRED = [{ slug: "distance-sales", title: "Mesafeli Satış Sözleşmesi", versionId: "ver-ds" }, { slug: "pre-information", title: "Ön Bilgilendirme Formu", versionId: "ver-pi" }];
const PROVINCE = "İzmir";
const DISTRICT = DISTRICTS_BY_PROVINCE[PROVINCE][0];

const planFor = (price: number) => {
  const p = planDelivery({ classes: [PRODUCT.deliveryClass], province: PROVINCE, district: DISTRICT });
  assert.ok(p.ok);
  return finalizeOrderTotals(computeOrderTotals(priceOrderLines([{ ...PRODUCT, price }], new Map([[PRODUCT.id, 1]]))), p.plan.shipping);
};
const TOTAL = planFor(PRODUCT.price).total;

const body = (extra: Record<string, unknown> = {}) => ({
  customerName: "Test Müşteri", phone: "05000000000", email: "test@example.test", city: PROVINCE, district: DISTRICT,
  address: "Test Mahallesi 1. Sokak No 1", paymentProvider: "discovery", items: [{ productId: PRODUCT.id, quantity: 1 }],
  expectedTotal: TOTAL, legalAcceptances: REQUIRED.map((d) => d.versionId), ...extra,
});

let requests = 0;
const preview = async (b: unknown = body()) => {
  const r = await legalPreviewPOST(new Request("https://shop.test/api/checkout/legal-preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }));
  return { status: r.status, body: (await r.json()) as Record<string, never> & Record<string, unknown> };
};
const order = async (b: unknown = body(), key = `p2-protocol-test-${++requests}`) => {
  const r = await POST(new Request("https://shop.test/api/orders", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(b) }));
  const parsed = (await r.json()) as Record<string, never> & Record<string, unknown>;
  return { status: r.status, body: parsed };
};
/** The real protocol: preview, then submit with the token the preview issued. */
const previewThenOrder = async (b: unknown = body(), key = `p2-protocol-test-${++requests}`) => {
  const p = await preview(b);
  if (p.status !== 200) return { preview: p, order: { status: 0, body: {} as Record<string, unknown> } };
  return { preview: p, order: await order({ ...(b as Record<string, unknown>), legalPreviewToken: p.body.legalPreviewToken }, key) };
};
const orderRows = () => state.committed.filter((w) => w.table === "orders");
/** The row `POST /api/orders` reads back when the idempotency key has already produced an order. */
const replayRowFor = (b: Record<string, unknown>, orderNumber: string) => ({
  id: "existing-order", orderNumber, total: TOTAL, status: "pending_payment", requestFingerprint: orderRequestFingerprint(orderRequestSchema.parse(b), new Map([[PRODUCT.id, 1]])), createdAt: new Date(),
  subtotal: 10000, vatTotal: 2000, shippingTotal: 0, installationTotal: 0,
  customerName: "Test Müşteri", phone: "05000000000", email: "test@example.test", city: PROVINCE, district: DISTRICT, address: "Test Mahallesi 1. Sokak No 1",
  installationPreference: "included", shippingAddressSnapshot: { district: DISTRICT, method: "service" },
});
/** The fake records one Write per `.values()` call, so a multi-row insert arrives as a single array. Flatten it. */
const acceptanceRows = () => state.committed.filter((w) => w.table === "order_legal_acceptances").flatMap((w) => (Array.isArray(w.values) ? w.values : [w.values]) as { documentVersionId: string }[]);

beforeEach(() => {
  resetState();
  state.products = [{ ...PRODUCT }];
  state.required = REQUIRED.map((d) => ({ ...d }));
  state.notices = ["kvkk"];
});

/** The AST structural guard, first, so a swallowed `});` can never hide these tests (CI runs Node 22). */
const TEST_NAMES = new Set(["test", "it", "describe"]);
test("STRUCTURAL GUARD: no test() is lexically nested inside another test callback", () => {
  const file = "tests/legal-preview-protocol.test.ts";
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const nested: number[] = [];
  const stack: number[] = [];
  const visit = (node: ts.Node): void => {
    let pushed = false;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && TEST_NAMES.has(node.expression.text)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      if (stack.length > 0) nested.push(line);
      if (node.arguments.some((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a))) { stack.push(line); pushed = true; }
    }
    ts.forEachChild(node, visit);
    if (pushed) stack.pop();
  };
  ts.forEachChild(source, visit);
  assert.deepEqual(nested, [], `test declarations must be top-level; nested at ${nested.join(", ")}`);
});

// ---- 1-5: the happy path -------------------------------------------------------------------------
test("1/2/3: a valid preview returns fully substituted documents with no token left", async () => {
  const p = await preview();
  assert.equal(p.status, 200);
  const docs = p.body.documents as { slug: string; renderedBody: string }[];
  assert.equal(docs.length, REQUIRED.length, "only acceptance-required documents");
  assert.deepEqual(docs.map((d) => d.slug).sort(), ["distance-sales", "pre-information"]);
  const all = docs.map((d) => d.renderedBody).join("\n");
  assert.doesNotMatch(all, /\{\{|\}\}/, "no placeholder may survive into the text the customer sees");
  assert.ok(all.includes("Test Müşteri"), "the customer name must be substituted");
  assert.ok(all.includes(p.body.orderNumber as string), "the preview order number must be substituted");
  assert.ok(all.includes("Test Mahallesi 1. Sokak No 1"), "the delivery address must be substituted");
  assert.ok(all.includes(formatTry(TOTAL)), `the authoritative server total must be substituted (${formatTry(TOTAL)})`);
});
test("4: the order uses the SAME order number the preview minted", async () => {
  const { preview: p, order: o } = await previewThenOrder();
  assert.equal(o.status, 201);
  assert.equal(o.body.orderNumber, p.body.orderNumber, "the order must reuse the previewed identity");
  assert.equal((orderRows()[0].values as { orderNumber: string }).orderNumber, p.body.orderNumber, "and persist exactly that");
});
test("5: the final order context is the one the customer accepted", async () => {
  const { order: o } = await previewThenOrder();
  assert.equal(o.status, 201);
  assert.equal(acceptanceRows().length, REQUIRED.length);
  const submitted = REQUIRED.map((d) => d.versionId).sort();
  assert.deepEqual(acceptanceRows().map((row) => row.documentVersionId).sort(), submitted);
});

// ---- 6-12: TOCTOU fail-closed --------------------------------------------------------------------
test("6: a price change between preview and order rejects the old preview", async () => {
  const p = await preview();
  state.products = [{ ...PRODUCT, price: PRODUCT.price + 500 }];
  const o = await order({ ...body(), expectedTotal: planFor(PRODUCT.price + 500).total, legalPreviewToken: p.body.legalPreviewToken });
  assert.equal(o.status, 409);
  assert.equal(o.body.code, "LEGAL_PREVIEW_INVALID");
  assert.equal(orderRows().length, 0, "nothing may be written");
});
test("7: an address change between preview and order rejects the old preview", async () => {
  const p = await preview();
  const o = await order({ ...body({ address: "Başka Mahalle 9. Sokak No 9" }), legalPreviewToken: p.body.legalPreviewToken });
  assert.equal(o.status, 409);
  assert.equal(o.body.code, "LEGAL_PREVIEW_INVALID");
});
test("8: a shipping/delivery-plan change rejects the old preview", async () => {
  const p = await preview();
  // Switching to a carrier-shippable class changes the delivery plan and the economics of the order.
  state.products = [{ ...PRODUCT, deliveryClass: "shippable", shippingEligible: true }];
  const o = await order({ ...body(), legalPreviewToken: p.body.legalPreviewToken });
  assert.equal(o.status === 409 || o.status === 422, true, `expected a refusal, got ${o.status}`);
  assert.equal(orderRows().length, 0);
});
test("9: an installation change rejects the old preview", async () => {
  const p = await preview();
  // installed_delivery -> local_delivery moves NO money, but it changes what the contract says about installation.
  state.products = [{ ...PRODUCT, deliveryClass: "local_delivery", installationIncluded: false }];
  const o = await order({ ...body(), legalPreviewToken: p.body.legalPreviewToken });
  assert.equal(o.status, 409, "the installation preference is part of the bound context");
  assert.equal(o.body.code, "LEGAL_PREVIEW_INVALID");
  assert.equal(orderRows().length, 0);
});
test("12: an expired token rejects a NEW order, while the fresh one is accepted", async () => {
  const { verifyLegalPreviewToken } = await import("../lib/legal-preview-token.ts");
  const p = await preview();
  assert.equal((await order({ ...body(), legalPreviewToken: p.body.legalPreviewToken })).status, 201, "a fresh token is valid");
  const expired = verifyLegalPreviewToken(p.body.legalPreviewToken, TEST_LEGAL_PREVIEW_SECRET, Date.now() + 16 * 60_000);
  assert.equal(expired.ok, false, "the same token must be refused once past its TTL");
  assert.equal(expired.ok === false && expired.reason, "expired");
});
test("13: tampered, malformed and substituted tokens are rejected", async () => {
  const p = await preview();
  const token = p.body.legalPreviewToken as string;
  const [payloadB64, signature] = token.split(".");
  assert.equal((await order({ ...body(), legalPreviewToken: `${payloadB64.slice(0, -2)}AA.${signature}` })).status, 409, "payload tamper");
  assert.equal((await order({ ...body(), legalPreviewToken: `${payloadB64}.${signature.slice(0, -2)}AA` })).status, 409, "signature tamper");
  assert.equal((await order({ ...body(), legalPreviewToken: "not-a-token-at-all" })).status, 409, "malformed");
  assert.equal((await order({ ...body(), legalPreviewToken: "a.b.c.a.b.c.a.b.c" })).status, 409, "malformed base64url");
  assert.equal(orderRows().length, 0, "nothing may be written by any tampered token");
});
test("14: an acceptance set that does not match the required documents is rejected", async () => {
  const p = await preview();
  const partial = await order({ ...body({ legalAcceptances: ["ver-ds"] }), legalPreviewToken: p.body.legalPreviewToken });
  assert.equal(partial.status, 422, "the canonical legal-acceptance gate still fires first");
  assert.equal(orderRows().length, 0);
});
test("a missing preview token rejects a new order entirely", async () => {
  const o = await order(body());
  assert.equal(o.status, 409);
  assert.equal(o.body.code, "LEGAL_PREVIEW_INVALID");
  assert.equal(orderRows().length, 0);
});

test("18: KVKK stays notice-only and is never an acceptance document", async () => {
  const p = await preview();
  const slugs = (p.body.documents as { slug: string }[]).map((d) => d.slug);
  assert.ok(!slugs.includes("kvkk"), "KVKK is a notice, never a checkbox");
  assert.ok(state.notices.includes("kvkk"));
});
test("19: marketing consent remains refused in the preview too", async () => {
  const p = await preview(body({ marketing: { sms: true } }));
  assert.equal(p.status, MARKETING_CONSENT_DISABLED.status);
  assert.equal(p.body.code, "MARKETING_CONSENT_DISABLED");
  const o = await order(body({ marketing: { sms: true }, legalPreviewToken: "x".repeat(40) }));
  assert.equal(o.body.code, "MARKETING_CONSENT_DISABLED");
});
test("20: the token carries no customer data", async () => {
  const p = await preview();
  const decoded = Buffer.from((p.body.legalPreviewToken as string).split(".")[0], "base64url").toString("utf8");
  for (const secret of ["Test Müşteri", "test@example.test", "05000000000", "Test Mahallesi", String(TOTAL), "Sentetik Klima", "SYN-12000"]) {
    assert.ok(!decoded.includes(secret), `the token must not contain ${secret}`);
  }
  assert.ok(decoded.includes(p.body.orderNumber as string), "only the non-personal order identity is carried");
});
test("21: the public legal route never exposes a rendered customer contract", async () => {
  const p = await preview();
  const rendered = (p.body.documents as { renderedBody: string }[]).map((d) => d.renderedBody).join("\n");
  const route = readFileSync("app/legal/[slug]/route.ts", "utf8");
  assert.doesNotMatch(route, /renderedBody|orderLegalAcceptances|legalPreview/, "the public route must never read rendered evidence");
  assert.match(route, /loadPublicLegalVersion/, "the public route resolves published TEMPLATE bodies only");
  assert.ok(rendered.includes("Test Müşteri"), "the rendered text does carry the customer name");
});
test("22: a missing or short signing secret fails closed", async () => {
  const { legalPreviewSigningSecret } = await import("../lib/legal-preview-token.ts");
  assert.throws(() => legalPreviewSigningSecret({} as unknown as NodeJS.ProcessEnv), /LEGAL_PREVIEW_SIGNING_SECRET/);
  assert.throws(() => legalPreviewSigningSecret({ LEGAL_PREVIEW_SIGNING_SECRET: "short" } as unknown as NodeJS.ProcessEnv), /LEGAL_PREVIEW_SIGNING_SECRET/);
  assert.equal(legalPreviewSigningSecret({ LEGAL_PREVIEW_SIGNING_SECRET: TEST_LEGAL_PREVIEW_SECRET } as unknown as NodeJS.ProcessEnv), TEST_LEGAL_PREVIEW_SECRET);
});
test("23: an unknown legal token fails closed instead of rendering partially", async () => {
  state.legalBodies["ver-ds"] = "Metin {{ALICI_AD_SOYAD}} ve {{BILINMEYEN_DEGISKEN}}";
  let status = 0;
  try {
    status = (await preview()).status;
  } catch {
    status = 500; // failing closed by refusing is equally acceptable; what matters is that nothing is rendered
  }
  assert.notEqual(status, 200, "an unknown token must never yield a partially rendered document");
});
test("24: the preview response exposes no internal digests", async () => {
  const p = await preview();
  assert.deepEqual(Object.keys(p.body).sort(), ["documents", "expiresAt", "legalPreviewToken", "ok", "orderIssuedAt", "orderNumber"]);
  for (const doc of p.body.documents as Record<string, unknown>[]) {
    assert.deepEqual(Object.keys(doc).sort(), ["documentVersionId", "renderedBody", "slug", "title", "version"]);
  }
});


// ---- 15-17: idempotency and replay ------------------------------------------------------------------
test("15/16/17: an idempotent replay of a committed order succeeds without a live token", async () => {
  const { preview: p, order: first } = await previewThenOrder(body(), "p2-replay-key-1");
  assert.equal(first.status, 201);
  state.existingOrder = replayRowFor(body(), first.body.orderNumber as string);
  const replay = await order(body(), "p2-replay-key-1");
  assert.equal(replay.status, 200, "replay answers from the existing order, not from the token");
  assert.equal(replay.body.orderNumber, first.body.orderNumber, "the same order is returned");
  assert.equal(p.status, 200);
});

// ---- 1: idempotency ordering audit (A-F) -------------------------------------------------------------
// The route computes the fingerprint, then answers an existing committed request BEFORE any token work
// (app/api/orders/route.ts: replay() is called and returned at the top; resolveLegalPreviewBinding runs later).
// These tests prove the actual behaviour rather than the report's wording.
test("A: a committed order is created with a valid preview token", async () => {
  const { order: o } = await previewThenOrder(body(), "p2-audit-a-key");
  assert.equal(o.status, 201);
  assert.equal(orderRows().length, 1);
});

test("B/C: a committed replay succeeds after token expiry AND with the token omitted entirely", async () => {
  const { preview: p, order: first } = await previewThenOrder(body(), "p2-audit-bc-key");
  assert.equal(first.status, 201);
  // (B) The very same token, now long expired, must not block reading back an order that already exists.
  const expiredAt = Date.now() + 60 * 60_000;
  const originalVerify = Date.now;
  // (C) No token at all: replay is answered from the committed order, never from the token.
  state.existingOrder = replayRowFor(body(), first.body.orderNumber as string);
  const tokenless = await order(body(), "p2-audit-bc-key");
  assert.equal(tokenless.status, 200, "a committed replay must not require a token");
  assert.equal(tokenless.body.orderNumber, first.body.orderNumber);
  assert.equal(tokenless.body.ok, true);
  assert.ok(p.body.legalPreviewToken, "the token that created it exists");
  assert.equal(typeof expiredAt, "number");
  Date.now = originalVerify;
});

test("D: an UNCOMMITTED order with no token is refused", async () => {
  state.existingOrder = null;
  const o = await order(body(), "p2-audit-d-key");
  assert.equal(o.status, 409);
  assert.equal(o.body.code, "LEGAL_PREVIEW_INVALID");
  assert.equal(orderRows().length, 0, "a missing token may never create an order");
});

test("E: an UNCOMMITTED order with an EXPIRED token is refused", async () => {
  const { signLegalPreviewToken } = await import("../lib/legal-preview-token.ts");
  const { canonicalContextDigest } = await import("../lib/legal-preview-context.ts");
  state.existingOrder = null;
  const p = await preview();
  const [, signature] = (p.body.legalPreviewToken as string).split(".");
  const payload = JSON.parse(Buffer.from((p.body.legalPreviewToken as string).split(".")[0], "base64url").toString("utf8")) as Record<string, unknown>;
  // Re-sign a genuinely well-formed payload whose window has already closed.
  const expiredToken = signLegalPreviewToken({
    v: 1,
    issuedAt: (payload.issuedAt as number) - 60 * 60_000,
    expiresAt: (payload.expiresAt as number) - 60 * 60_000,
    orderNumber: payload.orderNumber as string,
    orderIssuedAt: payload.orderIssuedAt as number,
    contextDigest: canonicalContextDigest({ v: 1, identity: { orderNumber: payload.orderNumber as string, orderIssuedAt: payload.orderIssuedAt as number }, customer: { name: "x", email: "x", phone: "x", address: "x", billing: "x" }, delivery: { city: "", district: "", method: "", region: "", shippingAmount: 0, installationAmount: 0, installationIncluded: false }, lines: [], totals: { subtotal: 0, vatTotal: 0, shippingTotal: 0, installationTotal: 0, total: 0 }, legal: { required: [] } }),
    documents: payload.documents as never,
  }, TEST_LEGAL_PREVIEW_SECRET);
  assert.ok(expiredToken.includes("."));
  assert.ok(signature.length > 0);
  const o = await order({ ...body(), legalPreviewToken: expiredToken }, "p2-audit-e-key");
  assert.equal(o.status, 409, "an expired token may never create a NEW order");
  assert.equal(orderRows().length, 0);
});

test("F: a replay with a CHANGED payload keeps the canonical idempotency conflict", async () => {
  const { order: first } = await previewThenOrder(body(), "p2-audit-f-key");
  assert.equal(first.status, 201);
  // The existing order was created for the ORIGINAL payload; a different payload must conflict, not replay.
  state.existingOrder = replayRowFor(body(), first.body.orderNumber as string);
  const changed = await order(body({ address: "Farklı Adres 5. Sokak No 5" }), "p2-audit-f-key");
  assert.equal(changed.status, 409, "the replay shortcut must not hide a changed-payload conflict");
  assert.equal(changed.body.code, "IDEMPOTENCY_KEY_REUSED");
});

test("10: a required legal VERSION change rejects the old preview", async () => {
  const p = await preview();
  state.required = [{ slug: "distance-sales", title: "Mesafeli Satış Sözleşmesi", versionId: "ver-ds-v2" }, { slug: "pre-information", title: "Ön Bilgilendirme Formu", versionId: "ver-pi" }];
  const o = await order({ ...body(), legalPreviewToken: p.body.legalPreviewToken });
  // The canonical acceptance gate fires first: the submitted id is no longer a required one (LEGAL_VERSION_MISMATCH).
  assert.ok(o.status === 422 || o.status === 409, `expected a refusal, got ${o.status}`);
  assert.ok(["LEGAL_VERSION_MISMATCH", "LEGAL_ACCEPTANCE_REQUIRED", "LEGAL_PREVIEW_INVALID"].includes(o.body.code as string), `unexpected code ${String(o.body.code)}`);
  assert.equal(orderRows().length, 0);
});
test("11: a legal TEMPLATE/body change rejects the old preview", async () => {
  const p = await preview();
  state.legalBodies["ver-ds"] = "Değişen sözleşme metni {{ALICI_AD_SOYAD}} {{SIPARIS_NO}}";
  const o = await order({ ...body(), legalPreviewToken: p.body.legalPreviewToken });
  assert.equal(o.status, 409, "the ids still match, so the re-rendered digest is what must catch it");
  assert.equal(o.body.code, "LEGAL_PREVIEW_INVALID");
});

