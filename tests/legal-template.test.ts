import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { LEGAL_TEMPLATE_TOKENS, LegalTemplateError, formatTry, renderOrderLegalDocument, type OrderLegalContext } from "../lib/legal-template.ts";
import { renderLegalBody } from "../lib/legal-render.ts";
import { checkoutAuthoritySource, orderRouteSource } from "./support/checkout-source.ts";

/**
 * STRUCTURAL GUARD - declared FIRST, on purpose.
 *
 * CI run 37144033239 failed on Node 22 while passing on Node 24: a test had lost its closing `});`, so later tests
 * became lexically nested inside its callback. Node 22's runner tracks nested `test()` as subtests of a synchronous
 * parent and fails it; Node 24 tolerates it. An indentation-based guard cannot see this, because a swallowed
 * declaration still sits at column 0 - only its lexical position betrays it.
 *
 * This guard parses the file with the repository's own TypeScript and walks the real AST. It is deliberately the
 * first test so it has already run if a later test ever swallows the rest of the file.
 */
const TEST_NAMES = new Set(["test", "it", "describe", "suite"]);

function nestedTestDeclarations(fileName: string): { name: string; line: number; inside: string }[] {
  const source = ts.createSourceFile(fileName, readFileSync(fileName, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const nested: { name: string; line: number; inside: string }[] = [];
  const stack: { name: string; line: number }[] = [];
  const visit = (node: ts.Node) => {
    let pushed = false;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && TEST_NAMES.has(node.expression.text)) {
      const name = node.expression.text;
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      if (stack.length > 0) nested.push({ name, line, inside: `${stack[stack.length - 1].name}() @ ${stack[stack.length - 1].line}` });
      if (node.arguments.some((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a))) { stack.push({ name, line }); pushed = true; }
    }
    ts.forEachChild(node, visit);
    if (pushed) stack.pop();
  };
  visit(source);
  return nested;
}

test("STRUCTURAL GUARD: no test() is lexically nested inside another test callback (AST)", () => {
  const nested = nestedTestDeclarations("tests/legal-template.test.ts");
  assert.deepEqual(nested, [], `test declarations must be top-level; found nesting: ${JSON.stringify(nested)}`);
});

test("STRUCTURAL GUARD: the AST walker really detects nesting (it is not a no-op)", () => {
  const broken = ['import test from "node:test";', 'test("parent", () => {', '  test("child", () => {});', "});"].join("\n");
  const parsed = ts.createSourceFile("s.ts", broken, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: string[] = [];
  const stack: string[] = [];
  const walk = (node: ts.Node) => {
    let pushed = false;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && TEST_NAMES.has(node.expression.text)) {
      if (stack.length > 0) found.push(node.expression.text);
      if (node.arguments.some((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a))) { stack.push(node.expression.text); pushed = true; }
    }
    ts.forEachChild(node, walk);
    if (pushed) stack.pop();
  };
  walk(parsed);
  assert.deepEqual(found, ["test"], "the walker must flag a nested test()");
});

const ctx = (over: Partial<OrderLegalContext> = {}): OrderLegalContext => ({
  ALICI_AD_SOYAD: "Ali Veli",
  ALICI_EPOSTA: "ali.veli@ornek.test",
  ALICI_TELEFON: "0542 000 00 00",
  TESLIMAT_ADRESI: "Cumhuriyet Mah. Ant Sk. No: 7 B, Kuşadası / Aydın",
  TESLIMAT_YONTEMI: "Satış temsilcisi teslimatı",
  SIPARIS_NO: "ETS-20261003-ABC123",
  SIPARIS_TARIHI: new Date("2026-10-03T09:00:00Z"),
  URUN_SATIRLARI: [{ productName: "Klima A", quantity: 2, unitPrice: 12500, lineTotal: 25000 }],
  URUN_TOPLAMI: 25000,
  TOPLAM_TUTAR: 29500,
  KARGO_UCRETI: 0,
  DIGER_EK_MASRAFLAR: 4500,
  FATURA_BILGILERI: "Ali Veli / Aydın",
  ...over,
});

const TEMPLATE = LEGAL_TEMPLATE_TOKENS.map((t) => `${t}={{${t}}}`).join("\n");


// ---- F/H: substitution, completeness, fail-closed ---------------------------------------------------
test("F: every supported token is substituted and nothing survives", () => {
  const out = renderOrderLegalDocument(TEMPLATE, ctx());
  assert.doesNotMatch(out, /\{\{|\}\}/, "no token may survive");
  for (const token of LEGAL_TEMPLATE_TOKENS) {
    const value = ctx()[token];
    assert.ok(out.includes(`${token}=`), `${token} line must render`);
    if (typeof value === "string") assert.ok(out.includes(`${token}=${value}`), `${token} must carry its authoritative value`);
  }
});
test("H: the canonical checkout-critical drafts render completely against a full context", () => {
  for (const slug of ["distance-sales", "pre-information"]) {
    const md = readFileSync(`docs/legal-drafts/${slug}.md`, "utf8");
    const real = [...md.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map((m) => m[1]);
    assert.ok(real.length > 0, `${slug} must contain tokens`);
    for (const token of real) assert.ok(LEGAL_TEMPLATE_TOKENS.includes(token as never), `${slug}: {{${token}}} must be a supported token`);
    assert.doesNotMatch(renderOrderLegalDocument(md, ctx()), /\{\{|\}\}/, `${slug} must render with no unresolved token`);
  }
});
test("G: an unknown token is refused, never rendered", () => {
  assert.throws(() => renderOrderLegalDocument("Merhaba {{ALICI_AD}}", ctx()), (e: unknown) => e instanceof LegalTemplateError && e.code === "UNKNOWN_TOKEN");
});
test("H2: a required token with no authoritative value is refused, never left blank", () => {
  const broken = { ...ctx() } as Record<string, unknown>;
  delete broken.ALICI_AD_SOYAD;
  assert.throws(() => renderOrderLegalDocument("{{ALICI_AD_SOYAD}}", broken as never), (e: unknown) => e instanceof LegalTemplateError && e.code === "MISSING_TOKEN_VALUE");
  assert.throws(() => renderOrderLegalDocument("{{ALICI_AD_SOYAD}}", ctx({ ALICI_AD_SOYAD: "   " })), (e: unknown) => e instanceof LegalTemplateError && e.code === "MISSING_TOKEN_VALUE");
});
test("H3: there is no silent partial rendering - a stray brace pair is refused", () => {
  assert.throws(() => renderOrderLegalDocument("Metin {{ }} sonrası", ctx()), (e: unknown) => e instanceof LegalTemplateError);
});
test("O: SIPARIS_NO and SIPARIS_TARIHI must be supplied explicitly; the renderer never invents them", () => {
  for (const token of ["SIPARIS_NO", "SIPARIS_TARIHI"] as const) {
    const missing = { ...ctx() } as Record<string, unknown>;
    delete missing[token];
    assert.throws(() => renderOrderLegalDocument(`{{${token}}}`, missing as never), (e: unknown) => e instanceof LegalTemplateError && e.code === "MISSING_TOKEN_VALUE", `${token} must be required`);
  }
  assert.ok(renderOrderLegalDocument("{{SIPARIS_NO}}", ctx()).includes(ctx().SIPARIS_NO));
});
test("ORDER_IDENTIFIER_PRE_ACCEPTANCE_DECISION: P1 must not mint an order number or date", () => {
  assert.doesNotMatch(readFileSync("lib/legal-template.ts", "utf8"), /randomUUID|Date\.now|new Date\(\)/, "the renderer must not generate an identifier or read the clock");
});

// ---- J/K/L/M: determinism ---------------------------------------------------------------------------
test("J: money formatting is deterministic and locale-independent", () => {
  assert.equal(formatTry(0), "₺0");
  assert.equal(formatTry(950), "₺950");
  assert.equal(formatTry(12500), "₺12.500");
  assert.equal(formatTry(1250000), "₺1.250.000");
  assert.equal(formatTry(-450), "-₺450");
  assert.throws(() => formatTry(10.5), (e: unknown) => e instanceof LegalTemplateError && e.code === "INVALID_TOKEN_VALUE");
  assert.equal(formatTry(12500), new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(12500), "must match the repo's existing money display");
});
test("K: the order date renders in Europe/Istanbul, independent of the machine's local zone", () => {
  // 22:30Z is already the next calendar day in Istanbul (UTC+3, no DST): proving the explicit zone, not the host's.
  const late = renderOrderLegalDocument("Tarih: {{SIPARIS_TARIHI}}", ctx({ SIPARIS_TARIHI: new Date("2026-10-03T22:30:00Z") }));
  assert.ok(late.includes("4 Ekim 2026"), `expected the Istanbul calendar date, got: ${late}`);
  const midday = renderOrderLegalDocument("Tarih: {{SIPARIS_TARIHI}}", ctx({ SIPARIS_TARIHI: new Date("2026-10-03T09:00:00Z") }));
  assert.ok(midday.includes("3 Ekim 2026"), `expected the Istanbul calendar date, got: ${midday}`);
});
test("L: line items keep the authoritative order and never depend on map iteration", () => {
  const lines = [{ productName: "B", quantity: 1, unitPrice: 100, lineTotal: 100 }, { productName: "A", quantity: 3, unitPrice: 50, lineTotal: 150 }];
  const out = renderOrderLegalDocument("{{URUN_SATIRLARI}}", ctx({ URUN_SATIRLARI: lines }));
  assert.equal(out.split("\n").length, 2);
  assert.ok(out.startsWith("- B "), "the caller's order is preserved, not re-sorted");
  assert.ok(out.includes("x3"));
});
test("M: the same context always produces byte-identical output", () => {
  const a = renderOrderLegalDocument(TEMPLATE, ctx());
  const b = renderOrderLegalDocument(TEMPLATE, ctx());
  assert.equal(a, b);
  assert.equal(Buffer.byteLength(a, "utf8"), Buffer.byteLength(b, "utf8"));
});

// ---- I: escaping -------------------------------------------------------------------------------------
test("I: adversarial customer values cannot inject HTML into the rendered legal page", () => {
  const payloads = ["<script>alert(1)</script>", '<img src=x onerror="alert(1)">', "Tom & Jerry", "a < b > c", '"quoted"', "'single'", "</p><b>kötü</b>"];
  for (const payload of payloads) {
    const html = renderLegalBody(renderOrderLegalDocument("Müşteri: {{ALICI_AD_SOYAD}} / {{TESLIMAT_ADRESI}}", ctx({ ALICI_AD_SOYAD: payload, TESLIMAT_ADRESI: payload })));
    // Only the renderer's own <p>/<br> wrapper may contain live tags; nothing from the payload may.
    const tags = html.match(/<[^>]+>/g) ?? [];
    assert.deepEqual(tags.filter((t) => t !== "<p>" && t !== "</p>" && t !== "<br>"), [], `payload must not create a live tag: ${payload}`);
    if (/[<>]/.test(payload)) assert.ok(html.includes("&lt;") || html.includes("&gt;"), `angle brackets must be escaped: ${payload}`);
    if (payload.includes("&")) assert.ok(html.includes("&amp;"), `ampersand must be escaped: ${payload}`);
  }
});
test("I2: escaping stays in exactly one place - the renderer returns plain text", () => {
  assert.equal(renderOrderLegalDocument("{{ALICI_AD_SOYAD}}", ctx({ ALICI_AD_SOYAD: "<b>x</b>" })), "<b>x</b>", "the renderer must not escape: renderLegalBody owns escaping");
});


// ---- A-E: the extraction did not change existing order behaviour ---------------------------------------
test("A: POST /api/orders delegates to the authority and keeps every write in its own transaction", () => {
  const route = orderRouteSource();
  const authority = checkoutAuthoritySource();
  assert.ok(route.includes("await resolveCheckoutAuthority("), "the route must consume the shared authority");
  assert.ok(route.indexOf("await resolveCheckoutAuthority(") < route.indexOf("tx.insert(customers)"), "the authority runs inside the locked transaction before writes");
  // All writes remain inside the transaction after locked authority verification.
  for (const marker of ["db.transaction(async (tx) => {", "tx.insert(customers)", "tx.insert(addresses)", "tx.insert(orders)", "tx.insert(orderItems)", "tx.insert(orderLegalAcceptances)", "onConflictDoNothing", "throw new IdempotentReplay()", "OUT_OF_STOCK:", "const acceptedAt = new Date();"]) {
    assert.ok(route.includes(marker), `the route must still contain ${marker}`);
  }
  // The authority writes nothing.
  assert.doesNotMatch(authority, /tx\.insert|\.insert\(|\.update\(|\.delete\(|db\.transaction/, "the authority module must never write");
  assert.doesNotMatch(authority, /Response\.json|new Response/, "the authority returns data, not HTTP");
});
test("B: the client total stays a guard only - it can refuse an order but never set the amount", () => {
  const authority = checkoutAuthoritySource();
  assert.ok(authority.includes("totalMatchesDisplayed(total, parsed.data.expectedTotal)"), "the displayed total is compared");
  assert.match(authority, /if \(!totalMatchesDisplayed[\s\S]{0,220}PRICE_CHANGED/, "a mismatch refuses the order");
  assert.doesNotMatch(authority, /total:\s*parsed\.data\.expectedTotal/, "the client total must never become the charged amount");
});
test("C: server product price remains authoritative", () => {
  const authority = checkoutAuthoritySource();
  assert.ok(authority.includes("priceOrderLines(rows.map(({ product }) => product), requested)"), "lines are priced from the DB row");
  assert.ok(authority.includes('eq(products.status, "published"), eq(products.saleMode, "online")'), "only sellable, published products are loaded");
  assert.ok(orderRouteSource().includes("unitPrice: product.price"), "the persisted unit price comes from the DB row");
  assert.doesNotMatch(authority, /parsed\.data\.items\[\d\]\.price|parsed\.data\.price/, "no client price may be read");
});
test("D: shipping remains server-derived from the delivery plan", () => {
  const authority = checkoutAuthoritySource();
  assert.ok(authority.includes("finalizeOrderTotals(computeOrderTotals(lines), plan.shipping)"), "shipping comes from the server's plan");
  assert.doesNotMatch(authority, /parsed\.data\.(shipping|shippingFee|shippingTotal|shippingAmount)\b/, "no client shipping field is read");
});
test("E: installation remains server-derived", () => {
  const authority = checkoutAuthoritySource();
  assert.doesNotMatch(authority, /parsed\.data\.(installation|installationAmount|installationPrice)\b/, "no client installation field is read");
  assert.ok(orderRouteSource().includes("installationPreferenceFor(plan.installationIncluded)"), "the preference is derived from the server plan");
});
test("E2: the authority returns exactly the values the route already used, and refuses in the original order", () => {
  const authority = checkoutAuthoritySource();
  // P3-LEGAL-3C.4/P2 split the authority into layers so a preview can stop before the acceptance gate. The
  // COMPOSED entry point must still run them in the canonical order, and each layer's own checks must keep theirs.
  const composed = authority.slice(authority.indexOf("export async function resolveCheckoutAuthority"));
  const composedOrder = ["resolveCheckoutPreflight", "assertOrderSubmissionLegalGates", "resolveCheckoutCalculation"];
  let cursor = -1;
  for (const marker of composedOrder) {
    const at = composed.indexOf(marker);
    assert.ok(at > cursor, `${marker} must run in the canonical order`);
    cursor = at;
  }
  const preflight = authority.slice(authority.indexOf("export async function resolveCheckoutPreflight"), authority.indexOf("export async function assertOrderSubmissionLegalGates"));
  const gates = authority.slice(authority.indexOf("export async function assertOrderSubmissionLegalGates"), authority.indexOf("export async function resolveCheckoutCalculation"));
  const calculation = authority.slice(authority.indexOf("export async function resolveCheckoutCalculation"), authority.indexOf("export async function resolveCheckoutAuthority"));
  for (const marker of ["isCustomerVisibleProduct", "marketingConsentRequested", "loadRequiredCheckoutLegalVersions"]) {
    assert.ok(preflight.includes(marker), `preflight must still run ${marker}`);
  }
  let gateCursor = -1;
  for (const marker of ["checkLegalAcceptance", "missingNoticeSlugs"]) {
    const at = gates.indexOf(marker);
    assert.ok(at > gateCursor, `${marker} must run in the canonical order`);
    gateCursor = at;
  }
  const calcOrder = ["db.select", "priceOrderLines", "planDelivery", "finalizeOrderTotals", "totalMatchesDisplayed"];
  let calcCursor = -1;
  for (const marker of calcOrder) {
    const at = calculation.indexOf(marker);
    assert.ok(at > calcCursor, `${marker} must run in the canonical order`);
    calcCursor = at;
  }
});

// ---- N: purity ----------------------------------------------------------------------------------------
test("N: the renderer performs no database, network, clock or randomness access", () => {
  const src = readFileSync("lib/legal-template.ts", "utf8");
  for (const forbidden of ["@/db", "getDb", "drizzle", "fetch(", "crypto", "randomUUID", "Math.random", "Date.now", "new Date("]) {
    assert.doesNotMatch(src, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `the renderer must not use ${forbidden}`);
  }
});
test("N2: rendering does not mutate the context it is given", () => {
  const context = ctx();
  const before = JSON.stringify(context.URUN_SATIRLARI);
  renderOrderLegalDocument(TEMPLATE, context);
  assert.equal(JSON.stringify(context.URUN_SATIRLARI), before);
});
