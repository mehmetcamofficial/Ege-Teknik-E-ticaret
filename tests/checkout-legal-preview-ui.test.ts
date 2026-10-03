import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import test from "node:test";
import ts from "typescript";
import { storefrontCoreSource, STOREFRONT_CORE } from "./support/storefront-sandbox.ts";
import { TEST_LEGAL_PREVIEW_SECRET } from "./support/legal-preview-harness.ts";
import { resetState, state } from "./support/order-route-fakes.ts";

/** P3-LEGAL-3C.4 / P2.2 - checkout CLIENT legal preview, executed against the REAL core and REAL routes. */
register("./support/order-route-hooks.mjs", import.meta.url);
const { POST } = await import("../app/api/orders/route.ts");
const { POST: legalPreviewPOST } = await import("../app/api/checkout/legal-preview/route.ts");

const TEST_NAMES = new Set(["test", "it", "describe"]);
test("STRUCTURAL GUARD: no test() is lexically nested inside another test callback (AST)", () => {
  const file = "tests/checkout-legal-preview-ui.test.ts";
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

/** Load the REAL client helpers from public/store-core.js rather than re-implementing them. */
function helpers(): Record<string, (...a: never[]) => unknown> {
  const src = storefrontCoreSource();
  const names = ["legalPreviewRelevantField", "legalPreviewExpired", "legalPreviewAcceptanceIds", "legalPreviewCartChanged"];
  // The relevance SET is a const, not a function: extract it too, or the helper cannot be evaluated in isolation.
  const setStart = src.indexOf("const LEGAL_PREVIEW_FIELDS=");
  const setEnd = src.indexOf(";", setStart) + 1;
  assert.ok(setStart > 0, "LEGAL_PREVIEW_FIELDS must exist in the storefront core");
  const body = src.slice(setStart, setEnd) + "\n" + names.map((n) => {
    const start = src.indexOf(`function ${n}(`);
    assert.ok(start > 0, `${n} must exist in ${STOREFRONT_CORE}`);
    let depth = 0;
    const open = src.indexOf("{", start);
    let end = open;
    for (; end < src.length; end++) {
      if (src[end] === "{") depth++;
      else if (src[end] === "}" && --depth === 0) break;
    }
    return src.slice(start, end + 1);
  }).join("\n");
  return new Function(`${body}\nreturn {${names.join(",")}};`)() as Record<string, (...a: never[]) => unknown>;
}

const PRODUCT = { id: "ui-ac-12000", name: "Sentetik Klima", sku: "SYN-12000", slug: "synthetic-ac", category: "Duvar Tipi", capacity: "12000", price: 12000, vatRateBps: 2000, status: "published", saleMode: "online", deliveryClass: "installed_delivery", installationIncluded: true, shippingEligible: false, stock: 10, reserved: 0 };
const REQUIRED = [{ slug: "distance-sales", title: "Mesafeli Satış Sözleşmesi", versionId: "ver-ds" }, { slug: "pre-information", title: "Ön Bilgilendirme Formu", versionId: "ver-pi" }];
const checkoutBody = (extra: Record<string, unknown> = {}) => ({
  customerName: "Test Müşteri", phone: "05000000000", email: "test@example.test", city: "İzmir", district: "Konak",
  address: "Test Mahallesi 1. Sokak No 1", paymentProvider: "discovery", items: [{ productId: PRODUCT.id, quantity: 1 }],
  expectedTotal: 12000, legalAcceptances: REQUIRED.map((d) => d.versionId), ...extra,
});
const previewOf = async (b: unknown = checkoutBody()) => {
  const r = await legalPreviewPOST(new Request("https://shop.test/api/checkout/legal-preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }));
  return { status: r.status, body: (await r.json()) as Record<string, never> & { documents?: { slug: string; version: number; documentVersionId: string; renderedBody: string }[] } };
};

const seed = () => {
  resetState();
  state.products = [{ ...PRODUCT }];
  state.required = REQUIRED.map((d) => ({ ...d }));
  state.notices = ["kvkk"];
};

test("5/21: the invalidation set covers every field the server binds, and not cosmetic ones", () => {
  const h = helpers();
  const relevant = h.legalPreviewRelevantField as (n: string) => boolean;
  for (const f of ["customerName", "phone", "email", "city", "district", "address", "delivery", "note"]) assert.equal(relevant(f), true, `${f} must invalidate`);
  for (const f of ["paymentProvider", "password", "coupon"]) assert.equal(relevant(f), false, `${f} must NOT invalidate`);
  assert.equal((h.legalPreviewCartChanged as () => boolean)(), true, "a cart change must invalidate");
});

test("18: helpers are pure, and acceptance ids come from the PREVIEW only", () => {
  const ids = helpers().legalPreviewAcceptanceIds as (p: unknown, c: string[]) => string[];
  const preview = { documents: [{ documentVersionId: "a" }, { documentVersionId: "b" }] };
  assert.deepEqual(ids(preview, ["a", "b"]), ["a", "b"]);
  assert.deepEqual(ids(preview, ["a"]), ["a"]);
  assert.deepEqual(ids(preview, []), []);
  assert.deepEqual(ids(preview, ["a", "b", "stale"]), ["a", "b"], "an id outside the preview can never be accepted");
});

test("14: expiry is a pure predicate (browser check is UX only)", () => {
  const e = helpers().legalPreviewExpired as (at: number, now: number) => boolean;
  assert.equal(e(1000, 999), false);
  assert.equal(e(1000, 1000), false, "the boundary instant is still valid");
  assert.equal(e(1000, 1001), true);
  assert.equal(e(undefined as never, 0), true, "a missing expiry counts as expired");
});

  seed();
test("3/18b: the token is memory-only - never storage, cookie, URL or console", () => {
  const src = storefrontCoreSource();
  const block = src.slice(src.indexOf("let legalPreview="), src.indexOf("function checkoutRequestPayload"));
  for (const forbidden of ["localStorage", "sessionStorage", "document.cookie", "indexedDB", "console.log", "location.search"]) {
    assert.ok(!block.includes(forbidden), `the legal preview block must not touch ${forbidden}`);
  }
  assert.match(src, /legalPreviewToken:legalPreview\.token/);
});

test("10: renderedBody is written with textContent, never innerHTML", () => {
  const src = storefrontCoreSource();
  const fn = src.slice(src.indexOf("function renderLegalPreview("), src.indexOf("async function requestLegalPreview"));
  assert.match(fn, /\.textContent=doc\.renderedBody/);
  for (const unsafe of ["innerHTML", "insertAdjacentHTML", "outerHTML"]) assert.ok(!fn.includes(unsafe), `must never use ${unsafe}`);
});


test("19: the prepare control is a real button and the status is an accessible live region", () => {
  const html = readFileSync("public/checkout.html", "utf8");
  assert.match(html, /<button type="button" data-legal-preview-prepare[^>]*>Hukuki metinleri hazırla<\/button>/);
  assert.match(html, /data-legal-preview-status[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /aria-labelledby="legal-preview-heading"/);
});

test("4: exactly ONE invalidation boundary, and it unchecks and disables every box", () => {
  const src = storefrontCoreSource();
  const fn = src.slice(src.indexOf("function invalidateLegalPreview("), src.indexOf("function renderLegalPreview("));
  for (const effect of ["legalPreview=null", "box.checked=false", "box.disabled=true", "renderLegalPreview()"]) assert.ok(fn.includes(effect), `must do ${effect}`);
  assert.equal((src.match(/legalPreview=null;legalPreviewLoading=false;/g) ?? []).length, 1, "only ONE boundary may clear the preview");
});

test("11: checkboxes stay native-required and are disabled until a preview exists", () => {
  const src = storefrontCoreSource();
  const fn = src.slice(src.indexOf("function renderLegalConsents("), src.indexOf("function acceptedLegalVersionIds"));
  assert.match(fn, /type="checkbox" required/, "native required must remain");
  assert.match(fn, /\$\{legalPreview\?'':' disabled'\}/, "boxes must be disabled until a preview exists");
  assert.doesNotMatch(fn, /\bchecked\b/, "boxes must never be pre-checked");
});

  seed();
test("6/12: only the button requests a preview; acceptance ids come from the preview", () => {
  const src = storefrontCoreSource();
  const wire = src.slice(src.indexOf("function wireLegalPreview("), src.indexOf("document.addEventListener('DOMContentLoaded'"));
  assert.match(wire, /prepare\.addEventListener\('click'[\s\S]{0,60}requestLegalPreview/);
  assert.equal((wire.match(/requestLegalPreview\(/g) ?? []).length, 1, "only the button may request");
  const builder = src.slice(src.indexOf("function checkoutRequestPayload("), src.indexOf("async function submitOrder"));
  assert.ok(!builder.includes("legalPreviewToken"), "the preview request must not carry a token");
  const submit = src.slice(src.indexOf("async function submitOrder"));
  assert.match(submit, /legalPreviewAcceptanceIds\(legalPreview,/);
  assert.match(submit, /legalAcceptances:previewAccepted/);
});

test("A-L: client -> preview -> accept -> order, against the REAL routes", async () => {
  seed();
  const h = helpers();
  const p = await previewOf();
  assert.equal(p.status, 200);
  const docs = p.body.documents!;
  const rendered = docs.map((d) => d.renderedBody).join("\n");
  assert.doesNotMatch(rendered, /\{\{|\}\}/, "zero unresolved placeholders in the text the customer reads");
  assert.ok(rendered.includes("Test Müşteri") && rendered.includes(p.body.orderNumber as string));
  const accepted = (h.legalPreviewAcceptanceIds as (x: unknown, c: string[]) => string[])(p.body, docs.map((d) => d.documentVersionId));
  assert.deepEqual(accepted.sort(), ["ver-ds", "ver-pi"]);
  const r = await POST(new Request("https://shop.test/api/orders", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "p2-ui-e2e-key" }, body: JSON.stringify(checkoutBody({ legalPreviewToken: p.body.legalPreviewToken, legalAcceptances: accepted })) }));
  const order = (await r.json()) as { orderNumber?: string; ok?: boolean };
  assert.equal(r.status, 201);
  assert.equal(order.orderNumber, p.body.orderNumber, "the order number shown must equal the previewed one");
  assert.equal(state.committed.filter((w) => w.table === "orders").length, 1, "exactly one order");
  assert.ok(TEST_LEGAL_PREVIEW_SECRET.length >= 32);
});

test("28/29/30: KVKK notice-only, marketing refused, expired token cannot create a new order", async () => {
  seed();
  const slugs = (await previewOf()).body.documents!.map((d) => d.slug);
  assert.ok(!slugs.includes("kvkk"), "KVKK is a notice, never an acceptance document");
  assert.equal((await previewOf(checkoutBody({ marketing: { sms: true } }))).status, 422, "marketing opt-in is still refused");
  const p = await previewOf();
  const { verifyLegalPreviewToken } = await import("../lib/legal-preview-token.ts");
  assert.equal(verifyLegalPreviewToken(p.body.legalPreviewToken, TEST_LEGAL_PREVIEW_SECRET, Date.now() + 20 * 60_000).ok, false);
  assert.equal(state.committed.filter((w) => w.table === "orders").length, 0);
});
