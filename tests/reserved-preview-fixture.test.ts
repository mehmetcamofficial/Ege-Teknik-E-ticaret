/**
 * P2-FIXTURE-B — the reserved Preview render fixture.
 *
 * Covers the security boundary and the renderer's real substitution contract using ONLY deterministic, code-owned
 * test material. No database is contacted, no legal document is published, and no real RC content is used.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderLegalBody } from "../lib/legal-render.ts";
import { LEGAL_TEMPLATE_TOKENS, LegalTemplateError, renderOrderLegalDocument, type OrderLegalContext } from "../lib/legal-template.ts";
import {
  LEGACY_FIXTURE_VERSION_IDS,
  RESERVED_PREVIEW_FIXTURE_BODY,
  RESERVED_PREVIEW_FIXTURE_VERSION_IDS,
  RESERVED_PREVIEW_FIXTURE_TOKENS,
  RESERVED_PREVIEW_FIXTURE_TITLE,
  VERIFIED_PREVIEW_NEON_BRANCH_ID,
  classifyLegalVersion,
  hasVerifiedPreviewFixtureIdentity,
  inspectLegalFixtureContamination,
  isLegalFixtureContaminated,
  isReservedPreviewFixtureId,
} from "../lib/legal-fixture-registry.ts";

const PREVIEW_ENV = {
  APP_ENV: "preview",
  NEON_BRANCH_ID: VERIFIED_PREVIEW_NEON_BRANCH_ID,
  EXPECTED_NEON_PREVIEW_BRANCH_ID: VERIFIED_PREVIEW_NEON_BRANCH_ID,
};
const PRODUCTION_ENV = {
  APP_ENV: "production",
  NEON_BRANCH_ID: "br-nameless-grass-aw9qpndy",
  EXPECTED_NEON_PREVIEW_BRANCH_ID: "br-nameless-grass-aw9qpndy",
};
const DEV_ENV = { APP_ENV: "development", NEON_BRANCH_ID: "br-noisy-sun-aw4t1fr2", EXPECTED_NEON_PREVIEW_BRANCH_ID: "br-noisy-sun-aw4t1fr2" };

const RESERVED_ID = "p2-preview-fixture-distance-sales-render-1";
type Row = { id: string; slug: string; version: number; publishedBy: string | null; contentHash: string };
const row = (id: string, slug = "distance-sales"): Row => ({ id, slug, version: 1, publishedBy: null, contentHash: "abc" });
const contaminated = (rows: Row[], env: Record<string, string | undefined>) => isLegalFixtureContaminated(inspectLegalFixtureContamination(rows, env));

const ORDINARY: Row = { id: "8116eae6-f768-4ec3-aef3-803d8ab8376f", slug: "distance-sales", version: 3, publishedBy: null, contentHash: "2363ceeb0981" };

/** A complete, authoritative context, so every token in the fixture body has a real value. */
const CONTEXT: OrderLegalContext = {
  ALICI_AD_SOYAD: "P2 Test Müşteri",
  ALICI_EPOSTA: "p2@example.test",
  ALICI_TELEFON: "05001112233",
  TESLIMAT_ADRESI: "P2 Test Mah. Test Cad. No:1 Bornova/İzmir",
  TESLIMAT_YONTEMI: "Adrese teslimat + standart montaj",
  SIPARIS_NO: "P2-TEST-0001",
  SIPARIS_TARIHI: new Date("2026-10-05T10:00:00+03:00"),
  URUN_SATIRLARI: [{ productName: "P2 Test Ürünü", quantity: 2, unitPrice: 12_345, lineTotal: 24_690 }],
  URUN_TOPLAMI: 24_690,
  TOPLAM_TUTAR: 24_690,
  KARGO_UCRETI: 0,
  DIGER_EK_MASRAFLAR: 0,
  FATURA_BILGILERI: "P2 Test Fatura Bilgisi",
};

// ---- A-D. the reserved fixture is servable ONLY under the exact verified Preview identity ----------------
test("A: a reserved fixture is accepted under the exact verified Preview identity", () => {
  assert.equal(contaminated([row(RESERVED_ID)], PREVIEW_ENV), false);
});

test("B: a missing Preview identity rejects the reserved fixture", () => {
  assert.equal(contaminated([row(RESERVED_ID)], {}), true);
  const { NEON_BRANCH_ID: _d, ...noBranch } = PREVIEW_ENV;
  assert.equal(contaminated([row(RESERVED_ID)], noBranch), true);
  assert.equal(contaminated([row(RESERVED_ID)], { ...PREVIEW_ENV, APP_ENV: undefined }), true);
});

test("C: a wrong Neon branch rejects the reserved fixture", () => {
  assert.equal(contaminated([row(RESERVED_ID)], { ...PREVIEW_ENV, NEON_BRANCH_ID: "br-somewhere-else" }), true);
  assert.equal(contaminated([row(RESERVED_ID)], { ...PREVIEW_ENV, EXPECTED_NEON_PREVIEW_BRANCH_ID: "br-mismatch" }), true);
});

test("D: Production and development identities both reject the reserved fixture", () => {
  assert.equal(contaminated([row(RESERVED_ID)], PRODUCTION_ENV), true);
  assert.equal(contaminated([row(RESERVED_ID)], DEV_ENV), true, "local/dev must never gain reserved-fixture authority");
  for (const value of ["Preview", "PREVIEW", " preview", ""]) {
    assert.equal(contaminated([row(RESERVED_ID)], { ...PREVIEW_ENV, APP_ENV: value }), true, `APP_ENV=${JSON.stringify(value)} accepted`);
  }
});

// ---- E-G. authority is identity-only ----------------------------------------------------------------
test("E: legacy fixtures do NOT gain reserved authority and keep their own classification", () => {
  for (const id of LEGACY_FIXTURE_VERSION_IDS) {
    assert.equal(classifyLegalVersion({ id }), "legacy_fixture", id);
    assert.equal(isReservedPreviewFixtureId(id), false, id);
  }
  assert.equal(classifyLegalVersion({ id: RESERVED_ID }), "reserved_preview_fixture");
});

test("F: title, body and publishedBy can NEVER manufacture reserved authority", () => {
  const impostors = [
    { ...row("ordinary-looking-id-1"), title: RESERVED_PREVIEW_FIXTURE_TITLE } as Row,
    { ...row("ordinary-looking-id-2"), publishedBy: "p2-preview-fixture-script" } as Row,
    { ...row("ordinary-looking-id-3"), publishedBy: RESERVED_ID } as Row,
  ];
  for (const r of impostors) assert.equal(classifyLegalVersion(r), "ordinary", r.id);
  assert.equal(contaminated(impostors, PRODUCTION_ENV), false, "text alone must not make a row reserved");
  assert.equal(contaminated(impostors, PREVIEW_ENV), false);
});

test("G: ordinary legal rows stay ordinary", () => {
  assert.equal(classifyLegalVersion(ORDINARY), "ordinary");
  assert.equal(contaminated([ORDINARY], PRODUCTION_ENV), false, "a clean Production inventory stays selectable");
});

test("only the two exact immutable IDs grant reserved authority", () => {
  assert.deepEqual([...RESERVED_PREVIEW_FIXTURE_VERSION_IDS], [
    "p2-preview-fixture-distance-sales-render-1",
    "p2-preview-fixture-pre-information-render-1",
  ]);
  for (const id of RESERVED_PREVIEW_FIXTURE_VERSION_IDS) {
    assert.equal(isReservedPreviewFixtureId(id), true);
    assert.equal(classifyLegalVersion({ id }), "reserved_preview_fixture");
    assert.equal(contaminated([row(id)], PREVIEW_ENV), false);
    for (const env of [PRODUCTION_ENV, DEV_ENV, {}, { ...PREVIEW_ENV, NEON_BRANCH_ID: "br-wrong" }, { ...PREVIEW_ENV, EXPECTED_NEON_PREVIEW_BRANCH_ID: undefined }])
      assert.equal(contaminated([row(id)], env), true);
  }
});

for (const id of ["p2-preview-fixture-attacker", "p2-preview-fixture-foo", "p2-preview-fixture-distance-sales-render-2"]) {
  test(`lookalike ${id} never gains authority and always fails closed without fallback`, () => {
    assert.equal(isReservedPreviewFixtureId(id), false);
    assert.equal(classifyLegalVersion({ id }), "ordinary", "prefix cannot grant reserved classification");
    for (const env of [PREVIEW_ENV, PRODUCTION_ENV, DEV_ENV, {}, { ...PREVIEW_ENV, NEON_BRANCH_ID: "br-wrong" }]) {
      const report = inspectLegalFixtureContamination([row(id), ORDINARY], env);
      assert.equal(isLegalFixtureContaminated(report), true);
      assert.deepEqual(report.reservedOffendingVersionIds, [id]);
    }
  });
}
// ---- H-I. no fallback ------------------------------------------------------------------------------
test("H: a reserved fixture contaminating Production still fails closed", () => {
  const report = inspectLegalFixtureContamination([row(RESERVED_ID), ORDINARY], PRODUCTION_ENV);
  assert.equal(isLegalFixtureContaminated(report), true);
  assert.equal(report.reservedOffendingVersionIds.length, 1);
});

test("I: a rejected reserved fixture NEVER falls back to the ordinary version of the same slug", () => {
  // Both rows are the same slug. A fallback would serve the real RC text in place of the fixture, which is exactly
  // the silent substitution this whole boundary exists to prevent.
  const report = inspectLegalFixtureContamination([row(RESERVED_ID), ORDINARY], PRODUCTION_ENV);
  assert.equal(isLegalFixtureContaminated(report), true);
  assert.equal(report.offendingVersionIds.includes(ORDINARY.id), false, "the ordinary row is not reported as an offending fixture");
  assert.deepEqual(report.reservedOffendingVersionIds, [RESERVED_ID], "and it is not promoted into the legacy list");
});

test("J/K: checkout and public legal loaders route through the one containment guard", () => {
  const db = readFileSync("lib/legal-db.ts", "utf8");
  for (const loader of ["loadRequiredCheckoutLegalVersions", "loadRequiredCheckoutLegalDocuments", "loadPublicLegalVersion", "loadCurrentLegalIndex"]) {
    const start = db.indexOf(`export async function ${loader}`);
    assert.ok(start > 0, `missing loader ${loader}`);
    assert.ok(db.indexOf("legalFixtureContaminated(db)", start) > start, `${loader} lost its guard`);
  }
  assert.match(db, /isLegalFixtureContaminated\(inspectLegalFixtureContamination\(/, "the reserved class must reach the loaders via the one guard");
});

// ---- L-N. the REAL renderer substitutes the fixture -------------------------------------------------
test("L: the real renderer substitutes EVERY token the reserved fixture uses", () => {
  const rendered = renderOrderLegalDocument(RESERVED_PREVIEW_FIXTURE_BODY, CONTEXT);
  assert.doesNotMatch(rendered, /\{\{|\}\}/, "no placeholder may survive a complete context");
  for (const expected of [CONTEXT.ALICI_AD_SOYAD, CONTEXT.ALICI_EPOSTA, CONTEXT.ALICI_TELEFON, CONTEXT.SIPARIS_NO, CONTEXT.TESLIMAT_YONTEMI, CONTEXT.FATURA_BILGILERI]) {
    assert.ok(rendered.includes(expected), `missing substitution: ${expected}`);
  }
  for (const expected of [
    "Müşteri: P2 Test Müşteri", "E-posta: p2@example.test", "Telefon: 05001112233",
    "Teslimat adresi: P2 Test Mah. Test Cad. No:1 Bornova/İzmir",
    "Teslimat yöntemi: Adrese teslimat + standart montaj", "Sipariş no: P2-TEST-0001",
    "Sipariş tarihi: 5 Ekim 2026", "Ürün satırları: - P2 Test Ürünü x2: ₺24.690",
    "Ara toplam: ₺24.690", "Toplam tutar: ₺24.690", "Kargo ücreti: ₺0",
    "Diğer ek masraflar: ₺0", "Fatura bilgileri: P2 Test Fatura Bilgisi",
  ]) assert.ok(rendered.includes(expected), `incorrect token substitution: ${expected}`);
  assert.ok(rendered.includes("PREVIEW RENDER TEST"), "the non-legal sentinel must survive rendering");
});

test("L2: the fixture body and the canonical allow-list can never drift apart", () => {
  const used = [...RESERVED_PREVIEW_FIXTURE_BODY.matchAll(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]);
  assert.deepEqual([...used].sort(), [...RESERVED_PREVIEW_FIXTURE_TOKENS].sort(), "body tokens != declared token list");
  assert.deepEqual([...LEGAL_TEMPLATE_TOKENS].sort(), [...RESERVED_PREVIEW_FIXTURE_TOKENS].sort(), "fixture must exercise the COMPLETE canonical set");
});

test("N: no unresolved placeholder remains for a complete valid context", () => {
  const rendered = renderOrderLegalDocument(RESERVED_PREVIEW_FIXTURE_BODY, CONTEXT);
  assert.equal(rendered.includes("{{"), false);
  assert.equal(rendered.includes("}}"), false);
});

test("O: missing and unsupported token behaviour stays deterministic and fail-closed", () => {
  assert.throws(() => renderOrderLegalDocument("{{NOT_A_REAL_TOKEN}}", CONTEXT), (e: unknown) => e instanceof LegalTemplateError && e.code === "UNKNOWN_TOKEN");
  assert.throws(() => renderOrderLegalDocument(RESERVED_PREVIEW_FIXTURE_BODY, { ...CONTEXT, SIPARIS_NO: "" }), (e: unknown) => e instanceof LegalTemplateError && e.code === "MISSING_TOKEN_VALUE");
  assert.throws(() => renderOrderLegalDocument(RESERVED_PREVIEW_FIXTURE_BODY, { ...CONTEXT, TOPLAM_TUTAR: 1.5 }), (e: unknown) => e instanceof LegalTemplateError && e.code === "INVALID_TOKEN_VALUE");
});

// ---- M. HTML-like customer input renders as TEXT --------------------------------------------------
test("M: HTML-like customer input is rendered as literal text, never as markup", () => {
  const hostile = "<b>P2-XSS-PROBE</b><script>alert(1)</script>";
  const rendered = renderOrderLegalDocument(RESERVED_PREVIEW_FIXTURE_BODY, { ...CONTEXT, ALICI_AD_SOYAD: hostile });
  assert.ok(rendered.includes(hostile), "the literal text must be present");
  const html = renderLegalBody(rendered);
  assert.ok(html.includes("&lt;b&gt;P2-XSS-PROBE&lt;/b&gt;&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.doesNotMatch(html, /<script>|<b>P2-XSS-PROBE/);
  // legal-template.ts escapes nothing by design - it returns PLAIN TEXT - and the browser inserts it via textContent,
  // so the markup survives verbatim as TEXT and is never parsed as HTML.
  const client = readFileSync("public/store-core.js", "utf8");
  const at = client.indexOf("body.textContent=doc.renderedBody");
  assert.ok(at > 0, "the browser must insert the rendered body via textContent");
  assert.doesNotMatch(client.slice(at - 200, at + 60), /innerHTML/, "no innerHTML may touch the rendered body");
});

// ---- the fixture itself can never be legal text ----------------------------------------------------
test("the reserved fixture is unmistakably non-legal and carries no RC content", () => {
  assert.match(RESERVED_PREVIEW_FIXTURE_BODY, /PREVIEW RENDER TEST — NOT LEGAL TEXT — TEST FIXTURE/);
  assert.match(RESERVED_PREVIEW_FIXTURE_TITLE, /NOT LEGAL TEXT/);
  for (const realText of ["Satıcı ve iletişim", "6698 sayılı", "Cayma hakkınız", "Mesafeli Satış Sözleşmesi"]) {
    assert.equal(RESERVED_PREVIEW_FIXTURE_BODY.includes(realText), false, `fixture contains real legal text: ${realText}`);
  }
  assert.equal(contaminated([row(RESERVED_ID)], PRODUCTION_ENV), true);
  assert.equal(hasVerifiedPreviewFixtureIdentity(PRODUCTION_ENV), false);
});
