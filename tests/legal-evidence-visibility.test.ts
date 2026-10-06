import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { toAcceptedLegalDocuments, type AcceptedLegalRow } from "../lib/legal.ts";
import { toOrderConfirmation, type PublicOrderItem } from "../lib/order-domain.ts";
import { storefrontCoreSource } from "./support/storefront-sandbox.ts";

/**
 * P3-LEGAL-3B - legal acceptance EVIDENCE VISIBILITY.
 *
 * Every `test()` in this file is a top-level declaration. Nothing is declared inside another test
 * callback: that nesting defect previously produced `cancelledByParent` on Node 22 (the CI runtime,
 * pinned by .nvmrc) while passing on Node 24.
 */
const read = (f: string) => readFileSync(f, "utf8");
const adminRoute = () => read("app/api/admin/orders/[id]/route.ts");
const legalDb = () => read("lib/legal-db.ts");
const orderRoute = () => read("app/api/orders/route.ts");
// P3-LEGAL-3C.3/P1: the server-authoritative checkout calculation now lives in its own read-and-calculate module.
const authoritySrc = read("lib/checkout-authority.ts");
const orderView = () => read("app/admin/(panel)/orders/order-detail-view.tsx");

const row = (slug: string, over: Partial<AcceptedLegalRow> = {}): AcceptedLegalRow => ({
  slug,
  title: `${slug} title`,
  version: 3,
  documentVersionId: `${slug}-id-v3`,
  ...over,
});

/**
 * STRUCTURAL GUARD - declared FIRST, on purpose.
 *
 * CI run 37144033239 failed on Node 22 while passing on Node 24: a test had lost its closing `});`,
 * so eight later tests became lexically nested inside its callback. Node 22's runner correctly tracks
 * nested `test()` as subtests of a synchronous parent and fails it (`subtestsFailed`); Node 24 tolerates
 * it entirely. An earlier indentation-based guard could NOT see this, because the swallowed declarations
 * all sit at column 0 - only their lexical position betrays them.
 *
 * This guard parses the file with the repository's own TypeScript compiler and walks the real AST, so it
 * detects containment regardless of formatting. It is deliberately the first test in the file: if a later
 * test ever swallows the rest of the file again, this one has already run and reported the truth.
 */
const TEST_DECLARATION_NAMES = new Set(["test", "it", "describe", "suite"]);

function findNestedTestDeclarations(fileName: string): { name: string; line: number; inside: string }[] {
  const source = ts.createSourceFile(fileName, read(fileName), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const nested: { name: string; line: number; inside: string }[] = [];
  // Stack of enclosing test-callback functions. A test call is illegal if this stack is non-empty.
  const stack: { name: string; line: number }[] = [];
  const visit = (node: ts.Node) => {
    let pushed = false;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && TEST_DECLARATION_NAMES.has(node.expression.text)) {
      const name = node.expression.text;
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      if (stack.length > 0) nested.push({ name, line, inside: `${stack[stack.length - 1].name}() @ line ${stack[stack.length - 1].line}` });
      // Only the arrow/function argument is a callback scope; the callee arguments are not.
      const callback = node.arguments.find((arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg));
      if (callback) {
        stack.push({ name, line });
        pushed = true;
      }
    }
    ts.forEachChild(node, visit);
    if (pushed) stack.pop();
  };
  visit(source);
  return nested;
}

test("STRUCTURAL GUARD: no test() call is lexically nested inside another test callback (AST)", () => {
  const file = "tests/legal-evidence-visibility.test.ts";
  const nested = findNestedTestDeclarations(file);
  assert.deepEqual(nested, [], `test declarations must be top-level; found nesting: ${JSON.stringify(nested)}`);
  assert.deepEqual(syntaxErrors(read(file), file), [], "this file must be syntactically valid");
});

test("STRUCTURAL GUARD: the AST walker actually detects nesting (it is not a no-op check)", () => {
  // Self-test on an intentionally broken sample, so a future refactor cannot silently neuter the guard.
  const sample = [
    'import test from "node:test";',
    'test("parent", () => {',
    '  test("child", () => {});',
    '});',
  ].join("\n");
  const parser = ts.createSourceFile("sample.ts", sample, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: string[] = [];
  const stack: string[] = [];
  const walk = (node: ts.Node) => {
    let pushed = false;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && TEST_DECLARATION_NAMES.has(node.expression.text)) {
      if (stack.length > 0) found.push(node.expression.text);
      if (node.arguments.some((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a))) { stack.push(node.expression.text); pushed = true; }
    }
    ts.forEachChild(node, walk);
    if (pushed) stack.pop();
  };
  walk(parser);
  assert.deepEqual(found, ["test"], "the walker must flag a nested test() declaration");
  // The orphan `});` that caused CI run 37144033239 was ALSO a syntax error, so the sample must compile
  // cleanly - proving the transpile-based check below has something real to detect.
  assert.deepEqual(syntaxErrors(sample, "sample.ts"), [], "the sample must parse cleanly");
});

/**
 * Syntax errors via the public transpile API (`SourceFile.parseDiagnostics` is not public API).
 * A swallowed/duplicated declaration leaves stray `});` behind, which this catches even on runtimes
 * whose test runner tolerates the resulting mis-nesting.
 */
function syntaxErrors(source: string, fileName: string): string[] {
  const result = ts.transpileModule(source, { fileName, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ESNext, isolatedModules: true } });
  return (result.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error).map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "));
}

// ---- ADMIN: the evidence join ---------------------------------------------------------------
test("admin order detail returns legal acceptances joined through versions and documents", () => {
  const src = adminRoute();
  assert.match(src, /loadOrderAcceptedLegalDocuments\(id\)/, "the order route must load the acceptance evidence");
  assert.match(src, /legalAcceptances/, "the response must carry them");
  // Authorisation is unchanged: the same admin:read guard, before anything is read.
  assert.match(src, /getAdminUser\("admin:read"\)/);
  assert.ok(src.indexOf('getAdminUser("admin:read")') < src.indexOf("await loadOrderAcceptedLegalDocuments(id)"), "authorization precedes the evidence read");
});

test("the acceptance join exposes slug, title, version, id and acceptedAt - and never the legal body", () => {
  const src = legalDb();
  for (const field of ["documentVersionId", "slug", "title", "version", "acceptedAt"]) {
    assert.match(src, new RegExp(`\\b${field}:`), `${field} must be selected`);
  }
  assert.match(src, /innerJoin\(legalDocumentVersions, eq\(legalDocumentVersions\.id, orderLegalAcceptances\.documentVersionId\)\)/);
  assert.match(src, /innerJoin\(legalDocuments, eq\(legalDocuments\.id, legalDocumentVersions\.documentId\)\)/);
  // The body is never pulled into an ORDER payload. (loadPublicLegalVersion below still selects it on
  // purpose - that is the public exact-version route, unchanged by this slice.)
  const orderLoader = src.match(/export async function loadOrderAcceptedLegalDocuments[\s\S]*$/)?.[0] ?? "";
  assert.doesNotMatch(orderLoader, /legalDocumentVersions\.body|contentHash/);
  // The admin route never reads the legal table directly - the loader above is the only path.
  assert.doesNotMatch(adminRoute(), /legalDocumentVersions/);
});

test("the admin order response stays no-store and adds no public lookup surface", () => {
  const src = adminRoute();
  assert.match(src, /"cache-control":"no-store"/);
  // No new unauthenticated route: the evidence lives only behind the existing admin guard.
  assert.match(src, /if\(!user\)return Response\.json\(\{error:"Yetkisiz erişim"\},\{status:403\}\)/);
});

// ---- ADMIN: presentation ---------------------------------------------------------------------
test("the admin order detail renders a Hukuki Kabul Kayıtları panel with version, timestamp and exact link", () => {
  const src = orderView();
  assert.match(src, /Hukuki Kabul Kayıtları/);
  assert.match(src, /Sürüm: \{d\.version\}/, "the version number must be visible");
  assert.match(src, /Kabul tarihi: \{trDate\(d\.acceptedAt, true\)\}/, "the acceptance timestamp must be visible");
  assert.match(src, /Kabul edilen metni görüntüle/, "a clearly named action to open the accepted text");
  // A real anchor, keyboard reachable, safely opened.
  assert.match(src, /<a href=\{acceptedLegalHref\(d\)\} target="_blank" rel="noopener"/);
  assert.match(src, /focus-visible:outline-ring/, "the link must be keyboard focusable");
});

test("the admin exact-version URL is built from slug + id and always carries the version parameter", () => {
  const src = orderView();
  assert.match(src, /acceptedLegalHref = \(d: AcceptedLegalDocumentView\) => `\/legal\/\$\{encodeURIComponent\(d\.slug\)\}\?version=\$\{encodeURIComponent\(d\.documentVersionId\)\}`/);
  // Never a bare /legal/{slug}: that would drift to whatever is effective now.
  assert.doesNotMatch(src, /href=\{`\/legal\/\$\{d\.slug\}`\}/);
});

// ---- shared ordering -------------------------------------------------------------------------
test("accepted documents are ordered pre-information, then distance-sales, then the rest", () => {
  const out = toAcceptedLegalDocuments([row("distance-sales"), row("privacy"), row("pre-information")]);
  assert.deepEqual(out.map((d) => d.slug), ["pre-information", "distance-sales", "privacy"]);
});

test("unknown or additional acceptances are still listed - the order preference never hides evidence", () => {
  const out = toAcceptedLegalDocuments([row("kvkk"), row("terms"), row("delivery-returns")]);
  assert.deepEqual(out.map((d) => d.slug), ["delivery-returns", "kvkk", "terms"]);
  assert.equal(toAcceptedLegalDocuments([]).length, 0);
});

test("the summary carries identity and display fields only - no body, no hash, no publisher", () => {
  const [first] = toAcceptedLegalDocuments([row("distance-sales")]);
  assert.deepEqual(Object.keys(first).sort(), ["documentVersionId", "slug", "title", "version"]);
  assert.doesNotMatch(JSON.stringify(first), /body|contentHash|publishedBy/i);
});

// ---- CUSTOMER: confirmation evidence ---------------------------------------------------------
const confirmationItems: PublicOrderItem[] = [{ productName: "Ürün", quantity: 1, unitPrice: 100, lineTotal: 100 }];
const confirmationInput = (over: Partial<Parameters<typeof toOrderConfirmation>[0]> = {}) => ({
  orderNumber: "ETS-1", status: "pending_payment", createdAt: "2026-10-03T10:00:00.000Z", items: confirmationItems,
  subtotal: 100, vatTotal: 20, shippingTotal: 0, installationTotal: 0, total: 120,
  customerName: "Ali Veli", phone: "0", email: "a@b.c", city: "İzmir", address: "Adres", installation: "none",
  ...over,
});

test("a successful order response carries the authoritative accepted-document summary", () => {
  const result = toOrderConfirmation(confirmationInput({ legalAcceptances: [row("distance-sales"), row("pre-information")] }));
  assert.deepEqual(result.legalAcceptances.map((d) => d.slug), ["pre-information", "distance-sales"]);
  assert.equal(result.legalAcceptances[0].documentVersionId, "pre-information-id-v3");
});

test("the confirmation summary defaults to an empty list rather than being absent", () => {
  assert.deepEqual(toOrderConfirmation(confirmationInput()).legalAcceptances, []);
});

test("the confirmation never embeds a legal body, hash or publisher", () => {
  const result = toOrderConfirmation(confirmationInput({ legalAcceptances: [row("distance-sales")] }));
  assert.doesNotMatch(JSON.stringify(result.legalAcceptances), /body|contentHash|publishedBy|effectiveAt/i);
});

test("the order route returns the summary on BOTH the fresh write and the idempotent replay", () => {
  const src = orderRoute();
  assert.match(src, /loadOrderLegalEvidenceSummary\(existing\.id, existing, reader\)/, "replay reads persisted evidence");
  assert.match(src, /const result = await replay\(\);[\s\S]*new Response\(result.body, \{ status: 201/, "fresh response uses that same persisted-read path");
  assert.equal((src.match(/toOrderConfirmation\(/g) ?? []).length, 1);
});

test("an idempotent replay yields an equivalent legal summary to the first response", () => {
  const accepted = [row("distance-sales"), row("pre-information")];
  const first = toOrderConfirmation(confirmationInput({ legalAcceptances: accepted }));
  const replay = toOrderConfirmation(confirmationInput({ legalAcceptances: [...accepted].reverse() }));
  // Same rows, different input order: the shared sorter must still produce an identical summary.
  assert.deepEqual(replay.legalAcceptances, first.legalAcceptances);
});

test("server-side legal validation, transaction rollback and idempotency are untouched", () => {
  const src = orderRoute();
  assert.match(authoritySrc, /loadRequiredCheckoutLegalVersions\(now, db\)/, "the server still resolves the required versions itself");
  assert.match(authoritySrc, /checkLegalAcceptance\(requiredLegal, parsed\.data\.legalAcceptances\)/, "client ids are still re-validated");
  assert.match(authoritySrc, /LEGAL_DOCUMENTS_UNAVAILABLE/, "fail-closed behaviour is preserved");
  assert.match(src, /db\.transaction\(async \(tx\) => \{/, "the write stays inside one transaction");
  assert.match(src, /IdempotentReplay/, "idempotency replay is preserved");
});

test("a legacy order with zero acceptances renders a neutral message, not an error or corruption claim", () => {
  const src = orderView();
  assert.match(src, /!acceptances\.length/);
  assert.match(src, /Bu sipariş için kayıtlı hukuki kabul bulunmuyor\./);
  assert.match(src, /hukuki kabul kaydı özelliğinden önce oluşturulmuş olabilir/);
  assert.doesNotMatch(src, /bozuk|korrupt|eksik kayıt/i, "zero acceptances is history, not corruption");
  // Nothing is manufactured for a missing record.
  assert.doesNotMatch(src, /\.insert\(|createAcceptance/, "the admin view must never write acceptances");
});

// ---- CHECKOUT: native required ---------------------------------------------------------------
test("checkout-required legal checkboxes carry native required semantics", () => {
  const src = storefrontCoreSource();
  assert.match(src, /<input type="checkbox" required data-legal-version=/, "the legal acceptance box must be natively required");
  // The existing JS guard and the server validation are NOT replaced, only backed up.
  assert.match(src, /if\(!legalConsentsComplete\(legalRequirements,accepted\)\)/);
});

test("nothing pre-checks a legal checkbox", () => {
  assert.doesNotMatch(storefrontCoreSource(), /<input type="checkbox"[^>]*\bchecked\b/);
});

test("KVKK stays notice-only and is never turned into a checkbox", () => {
  const src = storefrontCoreSource();
  assert.match(src, /renderKvkkNotices/, "KVKK remains a notice");
  assert.match(src, /d\.slug==='kvkk'/);
  // Check the code, not the comment that documents the rule (line 210 literally says "never a checkbox").
  const kvkkCode = src.split("\n").filter((l) => !/^\s*(\/\*|\*|\/\/)/.test(l)).join("\n");
  assert.doesNotMatch(kvkkCode, /kvkk[^\n]*checkbox/i, "KVKK must never become an acceptance box");
  assert.doesNotMatch(kvkkCode, /data-legal-version[^\n]*kvkk/i);
  // And the server still treats it as a notice, not an acceptance.
  assert.match(authoritySrc, /missingNoticeSlugs/);
  assert.doesNotMatch(orderRoute(), /kvkk[^\n]*checkLegalAcceptance/);
});

test("no marketing consent is introduced anywhere in checkout", () => {
  assert.doesNotMatch(storefrontCoreSource(), /data-marketing-channel[\s\S]{0,80}type="checkbox"/, "no marketing checkbox is rendered");
  assert.match(authoritySrc, /marketingConsentRequested\(parsed\.data\.marketing\)/, "marketing stays refused server-side");
  assert.match(authoritySrc, /MARKETING_CONSENT_DISABLED/, "the disabled marker is unchanged");
});

// ---- exact-version route safety (relied upon, deliberately unchanged) -------------------------
test("the exact-version legal route still serves only published, correctly-paired versions", () => {
  const src = read("app/legal/[slug]/route.ts");
  assert.match(src, /searchParams\.get\("version"\)/);
  assert.match(src, /loadPublicLegalVersion\(slug, requested\)/, "resolution goes through the published-only loader");
  assert.match(read("lib/legal-db.ts"), /isNotNull\(legalDocumentVersions\.publishedAt\)/, "drafts can never be served");
  assert.match(read("lib/legal.ts"), /resolvePublicLegalVersion/, "an unknown or wrong-slug id resolves to not_found");
  assert.match(src, /renderLegalNotFound\(\), \{ status: 404/);
});

// ---- regression: nothing was weakened ---------------------------------------------------------
test("no schema, migration or dependency file was touched by this slice", () => {
  const schema = read("db/schema.ts");
  assert.doesNotMatch(schema, /acceptanceSnapshot|acceptedTitle|acceptedVersion|acceptedSlug/);
  assert.match(read("app/api/orders/route.ts"), /orderLegalAcceptances\)\.values\(/, "acceptances are still written the same way");
  assert.match(read("tests/legal-checkout.test.ts"), /checkLegalAcceptance/, "the pre-existing rejection tests still exist");
});
