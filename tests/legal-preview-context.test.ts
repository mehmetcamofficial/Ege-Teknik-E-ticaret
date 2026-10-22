import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import test from "node:test";
import ts from "typescript";
import type { CheckoutAuthorityContext } from "../lib/checkout-authority.ts";
import { hashLegalDocument } from "../lib/legal.ts";
import { renderOrderLegalDocument } from "../lib/legal-template.ts";
import { RESERVED_PREVIEW_FIXTURE_VERSION_IDS } from "../lib/legal-fixture-registry.ts";
import { signLegalPreviewToken } from "../lib/legal-preview-token.ts";
import { TEST_LEGAL_PREVIEW_SECRET } from "./support/legal-preview-harness.ts";

register("./support/order-route-hooks.mjs", import.meta.url);
const { buildCanonicalLegalContext, buildLegalRenderContext, canonicalContextDigest, renderLegalPreviewDocuments } = await import("../lib/legal-preview-context.ts");
const { resolveLegalPreviewBinding } = await import("../lib/legal-preview-binding.ts");

const TEST_NAMES = new Set(["test", "it", "describe", "suite"]);

test("STRUCTURAL GUARD: no test declaration is nested inside a test callback", () => {
  const source = ts.createSourceFile("tests/legal-preview-context.test.ts", readFileSync("tests/legal-preview-context.test.ts", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const nested: number[] = [];
  const stack: number[] = [];
  const visit = (node: ts.Node): void => {
    let pushed = false;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && TEST_NAMES.has(node.expression.text)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      if (stack.length) nested.push(line);
      if (node.arguments.some((argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))) { stack.push(line); pushed = true; }
    }
    ts.forEachChild(node, visit);
    if (pushed) stack.pop();
  };
  visit(source);
  assert.deepEqual(nested, []);
});

const data = {
  customerName: "Test Müşteri",
  email: "test@example.test",
  phone: "05000000000",
  address: "Cumhuriyet Mah. Ant Sk. No: 7 B",
  city: "Aydın",
  district: "Kuşadası",
};

function line(id: string, name: string) {
  return {
    product: { id, sku: `SKU-${id}`, name, price: 1000, vatRateBps: 2000, deliveryClass: "local_delivery" },
    quantity: 1,
    vatAmount: 167,
    lineTotal: 1000,
  } as unknown as CheckoutAuthorityContext["lines"][number];
}

function calculation(lines = [line("product-b", "Ürün B"), line("product-a", "Ürün A")], method = "dealer") {
  return {
    ok: true,
    lines,
    products: lines.map(({ product }) => product),
    plan: { method, province: "Aydın", district: "Kuşadası", region: "service", shipping: { amount: 0, vatAmount: 0 }, installationIncluded: false },
    subtotal: 1666,
    vatTotal: 334,
    total: 2000,
    shippingTotal: 0,
    installationTotal: 0,
    requiredLegal: [{ slug: "distance-sales", versionId: "version-distance-sales" }],
    customer: { firstName: "Test", lastName: "Müşteri" },
  } as unknown as CheckoutAuthorityContext;
}

function canonical(method = "dealer", renderContextVersion: 1 | 2 = 2, lines = [line("product-b", "Ürün B"), line("product-a", "Ürün A")]) {
  return buildCanonicalLegalContext({
    calculation: calculation(lines, method),
    data,
    billing: "Test Müşteri / Aydın",
    orderNumber: "ETS-20261006-ABC123",
    orderIssuedAt: new Date("2026-10-05T21:30:00Z").getTime(),
    renderContextVersion,
  });
}

test("v1 explicitly preserves raw delivery values and caller line order", () => {
  const context = buildLegalRenderContext(canonical("dealer", 1));
  assert.equal(context.TESLIMAT_YONTEMI, "dealer");
  assert.equal(context.TESLIMAT_ADRESI, data.address);
  assert.deepEqual(context.URUN_SATIRLARI.map(({ productName }) => productName), ["Ürün B", "Ürün A"]);
});

test("v2 renders canonical delivery-method labels and fails closed for unknown codes", () => {
  const cases = [
    ["dealer", "Adrese teslim (Ege Teknik)"],
    ["pickup", "Mağazadan teslim"],
    ["shipping", "Kargo"],
  ] as const;
  for (const [method, label] of cases) assert.equal(buildLegalRenderContext(canonical(method)).TESLIMAT_YONTEMI, label);
  assert.throws(() => buildLegalRenderContext(canonical("courier")), /Teslimat yöntemi/);
});

test("v2 uses verified district and city for address delivery and an explicit pickup semantic", () => {
  const dealerAddress = buildLegalRenderContext(canonical("dealer")).TESLIMAT_ADRESI;
  assert.equal(dealerAddress, "Cumhuriyet Mah. Ant Sk. No: 7 B, Kuşadası / Aydın");
  assert.equal(buildLegalRenderContext(canonical("shipping")).TESLIMAT_ADRESI, dealerAddress);
  assert.equal(buildLegalRenderContext(canonical("pickup")).TESLIMAT_ADRESI, "Mağazadan teslim — teslimat adresi uygulanmaz");
});

test("v2 date token renders the Istanbul date derived from orderIssuedAt", () => {
  const date = renderOrderLegalDocument("{{SIPARIS_TARIHI}}", buildLegalRenderContext(canonical()));
  assert.equal(date, "6 Ekim 2026");
});

test("v2 sorts products by immutable product ID and stabilizes context and rendered digests", () => {
  const first = canonical("dealer", 2, [line("product-b", "Ürün B"), line("product-a", "Ürün A")]);
  const reversed = canonical("dealer", 2, [line("product-a", "Ürün A"), line("product-b", "Ürün B")]);
  assert.equal(canonicalContextDigest(first), canonicalContextDigest(reversed));
  const source = "{{URUN_SATIRLARI}}";
  const doc = { slug: "distance-sales", title: "Mesafeli Satış", versionId: "version-distance-sales", version: 4, contentHash: "a".repeat(64), body: source };
  const renderedFirst = renderLegalPreviewDocuments({ canonical: first, documents: [doc] })[0];
  const renderedReversed = renderLegalPreviewDocuments({ canonical: reversed, documents: [doc] })[0];
  assert.equal(renderedFirst.renderedBody, renderedReversed.renderedBody);
  assert.equal(renderedFirst.renderedSha256, renderedReversed.renderedSha256);
  assert.match(renderedFirst.renderedBody, /^- Ürün A/);
});

test("rendered SHA-256 is over the exact UTF-8 renderedBody bytes", () => {
  const doc = { slug: "distance-sales", title: "Mesafeli Satış", versionId: "version-distance-sales", version: 4, contentHash: "b".repeat(64), body: "Türkçe: {{SIPARIS_TARIHI}}" };
  const rendered = renderLegalPreviewDocuments({ canonical: canonical(), documents: [doc] })[0];
  const expected = createHash("sha256").update(Buffer.from(rendered.renderedBody, "utf8")).digest("hex");
  assert.equal(rendered.renderedSha256, expected);
});

test("successful binding exposes one complete, provenance-bound evidence contract", () => {
  const sourceDocuments = ["distance-sales", "pre-information"].map((slug, index) => {
    const title = index === 0 ? "Mesafeli Satış Sözleşmesi" : "Ön Bilgilendirme Formu";
    const body = `${title}: {{ALICI_AD_SOYAD}} / {{SIPARIS_TARIHI}} / {{TESLIMAT_YONTEMI}}`;
    return { slug, title, versionId: `version-${slug}`, version: 4 + index, contentHash: hashLegalDocument({ title, body }), body };
  });
  const context = canonical();
  const previewDocuments = renderLegalPreviewDocuments({ canonical: context, documents: sourceDocuments });
  const issuedAt = context.identity.orderIssuedAt;
  const token = signLegalPreviewToken({
    v: 1,
    issuedAt: 1000,
    expiresAt: 2000,
    orderNumber: context.identity.orderNumber,
    orderIssuedAt: issuedAt,
    renderContextVersion: 2,
    contextDigest: canonicalContextDigest(context),
    documents: previewDocuments.map(({ slug, documentVersionId, templateContentHash, renderedSha256 }) => ({ slug, documentVersionId, templateContentHash, renderedSha256 })),
  }, TEST_LEGAL_PREVIEW_SECRET);
  const acceptedAt = new Date("2026-10-05T21:40:00Z");
  const binding = resolveLegalPreviewBinding({
    data: { ...data, legalAcceptances: sourceDocuments.map(({ versionId }) => versionId) },
    calculation: calculation(),
    documents: sourceDocuments,
    token,
    secret: TEST_LEGAL_PREVIEW_SECRET,
    billing: "Test Müşteri / Aydın",
    acceptedAt,
    now: 1500,
  });
  assert.equal(binding.ok, true);
  if (!binding.ok) return;
  assert.equal(binding.evidence.orderIssuedAt.getTime(), issuedAt);
  assert.equal("rendered" in binding, false, "there is no second render representation beside evidence");
  assert.deepEqual(binding.evidence.documents.map(({ documentVersionId }) => documentVersionId).sort(), sourceDocuments.map(({ versionId }) => versionId).sort());
  for (const [index, evidence] of binding.evidence.documents.entries()) {
    const source = sourceDocuments.find(({ versionId }) => versionId === evidence.documentVersionId)!;
    const preview = previewDocuments.find(({ documentVersionId }) => documentVersionId === evidence.documentVersionId)!;
    assert.equal(evidence.slug, source.slug);
    assert.equal(evidence.title, source.title);
    assert.equal(evidence.version, source.version);
    assert.equal(evidence.templateContentHash, source.contentHash);
    assert.equal(evidence.renderedBody, preview.renderedBody);
    assert.equal(evidence.renderedSha256, preview.renderedSha256);
    assert.equal(evidence.renderContextVersion, 2);
    assert.equal(evidence.acceptedAt, acceptedAt);
    assert.equal(evidence.slug, sourceDocuments[index].slug);
  }
});

test("reserved Preview fixture IDs can render in preview but cannot bind committed evidence", () => {
  const token = signLegalPreviewToken({
    v: 1,
    issuedAt: 1000,
    expiresAt: 2000,
    orderNumber: "ETS-20261006-ABC123",
    orderIssuedAt: new Date("2026-10-05T21:30:00Z").getTime(),
    renderContextVersion: 2,
    contextDigest: "0".repeat(64),
    documents: RESERVED_PREVIEW_FIXTURE_VERSION_IDS.map((documentVersionId, index) => ({
      slug: index === 0 ? "distance-sales" : "pre-information",
      documentVersionId,
      templateContentHash: "1".repeat(64),
      renderedSha256: "2".repeat(64),
    })),
  }, TEST_LEGAL_PREVIEW_SECRET);
  const binding = resolveLegalPreviewBinding({
    data: { ...data, legalAcceptances: [...RESERVED_PREVIEW_FIXTURE_VERSION_IDS] },
    calculation: calculation(),
    documents: [],
    token,
    secret: TEST_LEGAL_PREVIEW_SECRET,
    billing: "Test Müşteri / Aydın",
    acceptedAt: new Date(1500),
    now: 1500,
  });
  assert.deepEqual(binding, { ok: false });
});