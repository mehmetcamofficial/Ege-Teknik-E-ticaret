import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { digestRenderedLegalBody } from "../lib/legal-preview-token.ts";
import { validatePersistedLegalEvidence, LegalEvidenceIntegrityError } from "../lib/legal-evidence.ts";
import { resetState, state } from "./support/order-route-fakes.ts";
import { TEST_LEGAL_PREVIEW_SECRET } from "./support/legal-preview-harness.ts";
register("./support/order-route-hooks.mjs", import.meta.url);
const { POST } = await import("../app/api/orders/route.ts");
const { POST: previewPOST } = await import("../app/api/checkout/legal-preview/route.ts");
const product = { id: "evidence-ac", name: "Sentetik <b>Klima</b>", sku: "EVIDENCE", slug: "evidence-ac", category: "Klima", capacity: "12000", price: 12000, vatRateBps: 2000, status: "published", saleMode: "online", deliveryClass: "installed_delivery" };
const required = [{ slug: "distance-sales", title: "Mesafeli satış", versionId: "evidence-ds" }, { slug: "pre-information", title: "Ön bilgi", versionId: "evidence-pi" }];
const payload = () => ({ customerName: "Sentetik Müşteri", phone: "05550000000", email: "evidence@example.test", city: "İzmir", district: "Aliağa", address: "<b>Adres</b> Mahallesi 1 Sokak", paymentProvider: "discovery", expectedTotal: 12000, items: [{ productId: product.id, quantity: 1 }], legalAcceptances: required.map((r) => r.versionId) });
const request = (body: unknown) => new Request("https://shop.test/api/orders", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "p3-evidence-request-1" }, body: JSON.stringify(body) });
const preview = async () => {
  const response = await previewPOST(request(payload())); assert.equal(response.status, 200);
  return await response.json() as { legalPreviewToken: string; orderIssuedAt: number; orderNumber: string; documents: { renderedBody: string; slug: string; documentVersionId: string }[] };
};
beforeEach(() => { resetState(); state.products = [product]; state.required = required; process.env.LEGAL_PREVIEW_SIGNING_SECRET = TEST_LEGAL_PREVIEW_SECRET; });
test("P3 exact verified bodies, UTF-8 hashes, source snapshots and frozen identity persist", async () => {
  const p = await preview(); const response = await POST(request({ ...payload(), legalPreviewToken: p.legalPreviewToken })); assert.equal(response.status, 201);
  const order = state.committed.find((w) => w.table === "orders")!.values as Record<string, unknown>;
  assert.equal(order.legalEvidenceVersion, 1); assert.equal((order.orderIssuedAt as Date).getTime(), p.orderIssuedAt); assert.equal(order.orderNumber, p.orderNumber);
  const rows = state.committed.find((w) => w.table === "order_legal_acceptances")!.values as Parameters<typeof validatePersistedLegalEvidence>[1]; assert.equal(rows.length, 2);
  for (const row of rows) {
    const displayed = p.documents.find((d) => d.slug === row.slug)!;
    assert.equal(row.renderedBody, displayed.renderedBody); assert.equal(row.renderedSha256, digestRenderedLegalBody(displayed.renderedBody));
    assert.equal(row.documentVersionId, displayed.documentVersionId); assert.equal(row.title, required.find((r) => r.slug === row.slug)!.title);
    assert.equal(row.version, 1); assert.match(row.templateContentHash!, /^[0-9a-f]{64}$/); assert.equal(row.renderContextVersion, 2); assert.equal(row.acceptanceType, "checkout_required");
    assert.equal(row.acceptedAt.getTime(), (order.createdAt as Date).getTime()); assert.ok(row.renderedBody!.includes("<b>Adres</b>"));
    assert.ok(row.renderedBody!.includes("Aliağa / İzmir")); assert.ok(row.renderedBody!.includes("Adrese teslim (Ege Teknik)")); assert.doesNotMatch(row.renderedBody!, /\{\{|\}\}/);
  }
  validatePersistedLegalEvidence(order as unknown as Parameters<typeof validatePersistedLegalEvidence>[0], rows);
  assert.doesNotMatch(JSON.stringify(await response.json()), /renderedBody|renderedSha256|templateContentHash|rendered_body/);
});
test("P3 replay needs no live token, authority, render or new evidence writes", async () => {
  const p = await preview(); assert.equal((await POST(request({ ...payload(), legalPreviewToken: p.legalPreviewToken }))).status, 201);
  const count = state.committed.length; const before = JSON.stringify(state.committed.filter((w) => w.table === "order_legal_acceptances")); state.products = []; state.required = [];
  assert.equal((await POST(request(payload()))).status, 200); assert.equal(state.committed.length, count); assert.equal(JSON.stringify(state.committed.filter((w) => w.table === "order_legal_acceptances")), before);
});
test("P3 changed meaningful payload keeps idempotency conflict", async () => {
  const p = await preview(); assert.equal((await POST(request({ ...payload(), legalPreviewToken: p.legalPreviewToken }))).status, 201);
  const r = await POST(request({ ...payload(), customerName: "Changed customer" })); assert.equal(r.status, 409); assert.equal((await r.json()).code, "IDEMPOTENCY_KEY_REUSED");
});
test("P3 replay detects corrupt evidence without exposing body or creating another order", async () => {
  const p = await preview(); assert.equal((await POST(request({ ...payload(), legalPreviewToken: p.legalPreviewToken }))).status, 201);
  const rows = state.committed.find((w) => w.table === "order_legal_acceptances")!.values as { renderedBody: string }[]; rows[0].renderedBody += " corruption";
  await assert.rejects(POST(request(payload())), LegalEvidenceIntegrityError);
  assert.equal(state.committed.filter((w) => w.table === "orders").length, 1);
});
test("P3 integrity validator rejects incomplete, duplicate, unknown-context and damaged evidence", () => {
  const now = new Date();
  const row = { documentVersionId: "ds", slug: "distance-sales", title: "DS", version: 1, templateContentHash: "a".repeat(64), renderedBody: "Türkçe <b>text</b>", renderedSha256: digestRenderedLegalBody("Türkçe <b>text</b>"), renderContextVersion: 2, acceptanceType: "checkout_required", acceptedAt: now };
  const identity = { legalEvidenceVersion: 1, orderIssuedAt: new Date(now.getTime() - 100), createdAt: now };
  const valid = [row, { ...row, slug: "pre-information", documentVersionId: "pi" }]; assert.equal(validatePersistedLegalEvidence(identity, valid).length, 2);
  for (const invalid of [[row], [row, row], [row, { ...valid[1], renderContextVersion: 99 }], [row, { ...valid[1], templateContentHash: null }], [row, { ...valid[1], renderedSha256: "0".repeat(64) }]]) assert.throws(() => validatePersistedLegalEvidence(identity, invalid), LegalEvidenceIntegrityError);
});
test("P3 migration is additive and contains no rendered backfill", () => {
  const sql = readFileSync("drizzle-pg/0015_immutable_legal_evidence.sql", "utf8"); assert.equal((sql.match(/ADD COLUMN/g) ?? []).length, 10);
  assert.doesNotMatch(sql, /UPDATE\s+orders\s+SET|UPDATE\s+order_legal_acceptances\s+SET|DROP\s+(TABLE|COLUMN)/i); assert.match(sql, /DEFERRABLE INITIALLY DEFERRED/); assert.match(sql, /BEFORE TRUNCATE/);
});
test("P3 evidence path never logs body/token or stores PII in browser storage", () => {
  for (const file of ["lib/legal-evidence-db.ts", "lib/legal-evidence.ts", "app/api/orders/route.ts"]) assert.doesNotMatch(readFileSync(file, "utf8"), /console\.(log|error|warn)|auditLogs|localStorage|sessionStorage/);
});
test("P3 AST syntax/nested-test guard covers both new suites", () => {
  for (const file of ["tests/p3-legal-evidence.test.ts", "tests/p3-legal-evidence-postgres.test.ts"]) {
    const source = readFileSync(file, "utf8"); assert.deepEqual(ts.transpileModule(source, { fileName: file, reportDiagnostics: true }).diagnostics?.filter((d) => d.category === ts.DiagnosticCategory.Error), []);
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const walk = (node: ts.Node, inside = false) => { const isTest = ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "test"; if (isTest) assert.equal(inside, false); ts.forEachChild(node, (child) => walk(child, inside || isTest)); }; walk(ast);
  }
});
