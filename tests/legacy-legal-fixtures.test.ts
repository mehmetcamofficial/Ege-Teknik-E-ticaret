import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LEGACY_FIXTURE_PUBLISHERS,
  LEGACY_FIXTURE_TITLE_MARKERS,
  REAL_RC_DRAFT_TITLES,
  isLegacyLegalFixture,
  legacyFixtureHidingActive,
  partitionLegalVersions,
} from "../lib/legal-fixtures.ts";

const read = (f: string) => readFileSync(f, "utf8");

/** The legacy fixture rows inventoried on the Preview branch (br-nameless-mountain-awib28a9), 2026-10-01. */
const FIXTURES: { title: string; publishedBy: string | null }[] = [
  { title: "DRAFT — PHASE 3B.3 ADMIN TEST — LEGAL REVIEW REQUIRED (v1)", publishedBy: "e7c9a5ef-adf0-4d65-84a6-6dc92c4fe72c" },
  { title: "DRAFT — PHASE 3B.3 ADMIN TEST — LEGAL REVIEW REQUIRED (v2)", publishedBy: "e7c9a5ef-adf0-4d65-84a6-6dc92c4fe72c" },
  { title: "DRAFT — PHASE 3B.3 ADMIN TEST — LEGAL REVIEW REQUIRED (v3)", publishedBy: "e7c9a5ef-adf0-4d65-84a6-6dc92c4fe72c" },
  { title: "PREVIEW TEST — distance-sales", publishedBy: "preview-fixture-script" },
  { title: "PREVIEW TEST — pre-information", publishedBy: "preview-fixture-script" },
  { title: "PREVIEW TEST — kvkk — NOT LEGAL TEXT — DO NOT COPY TO PRODUCTION", publishedBy: "e7c9a5ef-adf0-4d65-84a6-6dc92c4fe72c" },
  { title: "DRAFT — PHASE 3B.3 POSTGRES TEST — NOT LEGAL TEXT (edited)", publishedBy: "pg-test-3b3-script" },
];

/** The 7 real RC drafts, all unpublished, that must never be hidden. */
const REAL_DRAFTS: { title: string; publishedBy: string | null }[] = REAL_RC_DRAFT_TITLES.map((title) => ({ title, publishedBy: null }));

// ---- classification -------------------------------------------------------------------------------
test("every inventoried legacy fixture is recognised as a fixture", () => {
  for (const row of FIXTURES) assert.equal(isLegacyLegalFixture(row), true, `missed: ${row.title}`);
});
test("none of the seven real RC drafts is ever classified as a fixture", () => {
  for (const row of REAL_DRAFTS) assert.equal(isLegacyLegalFixture(row), false, `would wrongly hide: ${row.title}`);
  assert.equal(REAL_DRAFTS.length, 7, "the seven real RC drafts are the ones that must stay visible");
});
test("a genuine new draft created by the admin UI is never mistaken for a fixture", () => {
  // createDraft() in app/admin/legal-admin.tsx generates exactly this title for a real, new draft.
  for (const label of ["Mesafeli Satış Sözleşmesi", "KVKK Aydınlatma Metni", "Çerez Politikası"]) {
    assert.equal(isLegacyLegalFixture({ title: `DRAFT — LEGAL REVIEW REQUIRED — ${label}`, publishedBy: null }), false);
  }
});
test("a future real document that happens to contain the word 'test' is NOT hidden", () => {
  // The markers are deliberately specific phrases, not the bare word "test": over-matching would hide a
  // legitimate document with no way to recover it from the default view.
  for (const title of ["Test ve Ölçüm Koşulları", "Cihaz Test Prosedürü", "Sözleşme Testi", "Abortif"]) {
    assert.equal(isLegacyLegalFixture({ title, publishedBy: null }), false, `over-matched: ${title}`);
  }
});
test("classification is case-insensitive, and does not fall into the Turkish dotted-I trap", () => {
  assert.equal(isLegacyLegalFixture({ title: "preview test — distance-sales", publishedBy: null }), true);
  assert.equal(isLegacyLegalFixture({ title: "phase 3b.3 admin test", publishedBy: null }), true);
  // "admin" contains an 'i'. Under toLocaleUpperCase("tr") that folds to "ADMİN" (dotted capital I),
  // which would NOT match the ASCII marker "PHASE 3B.3" ... and would silently stop hiding the fixture.
  assert.equal("admin".toLocaleUpperCase("tr"), "ADMİN", "the trap this test guards against is real");
  assert.equal("admin".toUpperCase(), "ADMIN", "locale-independent folding is what the markers need");
  assert.equal(isLegacyLegalFixture({ title: "PHASE 3B.3 ADMİN TEST", publishedBy: null }), true, "marker part still matches");
  assert.equal(isLegacyLegalFixture({ title: "DRAFT — phase 3b.3 admin test — legal review required", publishedBy: null }), true);
});
test("a fixture script identity alone is enough, even if its title were later reworded", () => {
  for (const publisher of LEGACY_FIXTURE_PUBLISHERS) {
    assert.equal(isLegacyLegalFixture({ title: "Belge Başlığı", publishedBy: publisher }), true, publisher);
  }
  // A real admin's published_by is NOT a fixture signal.
  assert.equal(isLegacyLegalFixture({ title: "GERÇEK BELGE", publishedBy: "e7c9a5ef-adf0-4d65-84a6-6dc92c4fe72c" }), false);
});

// ---- partitioning ---------------------------------------------------------------------------------
test("partitioning hides exactly the fixtures and never loses a row", () => {
  const all = [...FIXTURES, ...REAL_DRAFTS];
  const { visible, hidden } = partitionLegalVersions(all);
  assert.equal(hidden.length, FIXTURES.length);
  assert.equal(visible.length, REAL_DRAFTS.length);
  assert.equal(visible.length + hidden.length, all.length, "partitioning is lossless");
  for (const title of REAL_RC_DRAFT_TITLES) assert.ok(visible.some((v) => v.title === title), `real draft hidden: ${title}`);
});
test("an empty list and a list with nothing to hide both behave", () => {
  assert.deepEqual(partitionLegalVersions([]), { visible: [], hidden: [] });
  const { visible, hidden } = partitionLegalVersions(REAL_DRAFTS);
  assert.equal(hidden.length, 0);
  assert.equal(visible.length, 7);
});

// ---- Preview-only gating --------------------------------------------------------------------------
test("fixture hiding is enabled for preview ONLY, and never for production", () => {
  assert.equal(legacyFixtureHidingActive("preview"), true);
  assert.equal(legacyFixtureHidingActive("production"), false, "Production must show the complete history");
  assert.equal(legacyFixtureHidingActive("development"), false);
  assert.equal(legacyFixtureHidingActive(undefined), false, "fail closed when APP_ENV is unset");
});



// ---- the route wires it correctly ------------------------------------------------------------------
test("the versions route hides by default, reveals on ?legacy=1, and gates both on APP_ENV", () => {
  const route = read("app/api/admin/legal/documents/[slug]/versions/route.ts");
  assert.match(route, /legacyFixtureHidingActive\(process\.env\.APP_ENV\)/, "the gate must read the real environment");
  assert.match(route, /showLegacy = legacyFixtureHidingActive\(process\.env\.APP_ENV\) && new URL\(request\.url\)\.searchParams\.get\("legacy"\) === "1"/);
  assert.match(route, /versions: showLegacy \? versions : visible/, "hidden by default, revealed on request");
  assert.match(route, /hiddenLegacyCount/, "the UI is told how many are hidden, so nothing disappears silently");
  // Status is derived from the FULL history before hiding, so hiding cannot change a real version's status.
  assert.ok(route.indexOf("deriveLegalStatus") < route.indexOf("partitionLegalVersions"), "derive status before partitioning");
});
test("the hiding path writes nothing: the route still exposes only GET and POST", () => {
  const route = read("app/api/admin/legal/documents/[slug]/versions/route.ts");
  assert.deepEqual([...route.matchAll(/export const (\w+)/g)].map((m) => m[1]), ["GET", "POST"]);
  assert.doesNotMatch(route, /db\.|delete\(|update\(|insert\(/i, "hiding is a read-side concern only");
  assert.doesNotMatch(route, /legalDocumentVersions|getDb/, "routes must go through lib/legal-admin-db.ts");
});
test("fixture identification is centralised: no screen re-implements a substring check", () => {
  for (const marker of LEGACY_FIXTURE_TITLE_MARKERS) {
    for (const file of ["app/admin/legal-admin.tsx", "app/api/admin/legal/documents/[slug]/versions/route.ts"]) {
      assert.ok(!read(file).includes(marker), `${file} must not hardcode the fixture marker ${marker}`);
    }
  }
  // And no admin screen filters legal versions by title at all.
  assert.doesNotMatch(read("app/admin/legal-admin.tsx"), /title\.includes|title\.toLowerCase\(\)\.includes/);
});
test("the immutability trigger and the legal data are untouched by this feature", () => {
  const migration = read("drizzle-pg/0005_legal_drafts_and_immutability.sql");
  assert.match(migration, /IF OLD\."published_at" IS NOT NULL THEN\s+RAISE EXCEPTION/);
  assert.doesNotMatch(migration, /DROP TRIGGER|DISABLE TRIGGER/i, "the guard must stay armed");
  // Hiding must not be able to mutate a version: nothing in the new code path writes to the table.
  assert.doesNotMatch(read("lib/legal-fixtures.ts"), /update\(|delete\(|insert\(|db\./);
});
test("the admin UI defaults to hidden and offers a way back in", () => {
  const ui = read("app/admin/legal-admin.tsx");
  assert.match(ui, /const \[showLegacy, setShowLegacy\] = useState\(false\)/, "default = hidden");
  assert.match(ui, /Eski\/Test kayıtlarını göster/, "an authorized admin can inspect the hidden history");
  assert.match(ui, /aria-pressed=\{showLegacy\}/, "the toggle reports its state");
  assert.match(ui, /\{showLegacy \? "Eski\/Test kayıtlarını gizle" : "Eski\/Test kayıtlarını göster"\}/, "the toggle is reversible");
  // The toggle survives every reload, so saving or deleting can never silently re-expose hidden fixtures.
  assert.doesNotMatch(ui, /\bloadVersions\(slug\)/, "every reload must pass the current toggle state");
});
test("the hiding is a client-visible count, so an operator is never silently missing records", () => {
  const ui = read("app/admin/legal-admin.tsx");
  assert.match(ui, /eski test kaydı gizleniyor/, "the UI states how many records are hidden and why");
  assert.match(ui, /hiddenLegacyCount > 0/);
});
