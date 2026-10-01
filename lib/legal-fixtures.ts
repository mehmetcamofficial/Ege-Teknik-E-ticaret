/**
 * Centralised identification of the legacy PREVIEW test fixtures in the legal registry.
 *
 * WHY THIS EXISTS. Every fixture row was published, so migration 0005's `legal_document_versions_guard`
 * trigger makes them immutable: no UPDATE and no DELETE can ever touch them, and two of them
 * (`preview-test-ver-distance-sales-2`, `preview-test-ver-pre-information-2`) are referenced by real
 * `order_legal_acceptances` rows. They therefore cannot be cleaned up, only kept out of the way.
 *
 * This module is the ONLY place that decides what a fixture is. Screens must never grow their own
 * substring checks: a scattered `title.includes("TEST")` would eventually hide a legitimate document
 * (for example a real one about testing) with no way to bring it back.
 *
 * The data is untouched. Hiding is a READ-side concern, applied by the admin versions route, and ONLY
 * when APP_ENV=preview - Production shows the complete, unfiltered history.
 */

/** Identities the fixture scripts wrote into `published_by`. Verifiable, but not sufficient on their own. */
export const LEGACY_FIXTURE_PUBLISHERS = ["preview-fixture-script", "pg-test-3b3-script"] as const;

/**
 * Title markers, each one verified against the Preview inventory on 2026-10-01 against all 16 rows.
 * Chosen to be unambiguous: none of them can occur in one of the seven real RC drafts, and none of
 * them matches the `DRAFT — LEGAL REVIEW REQUIRED — …` title the admin UI itself generates for a
 * genuinely new draft (see createDraft in app/admin/legal-admin.tsx).
 */
export const LEGACY_FIXTURE_TITLE_MARKERS = ["PHASE 3B.3", "PREVIEW TEST", "NOT LEGAL TEXT", "DO NOT COPY TO PRODUCTION"] as const;

/** The seven real RC drafts, kept here only so a test can prove none of them is ever classified as a fixture. */
export const REAL_RC_DRAFT_TITLES = [
  "ÇEREZ VE TARAYICI DEPOLAMA BİLGİLENDİRMESİ",
  "TESLİMAT, MONTAJ, İADE VE CAYMA KOŞULLARI",
  "MESAFELİ SATIŞ SÖZLEŞMESİ",
  "KİŞİSEL VERİLERİN İŞLENMESİNE İLİŞKİN AYDINLATMA METNİ",
  "ÖN BİLGİLENDİRME FORMU",
  "GİZLİLİK POLİTİKASI",
  "İNTERNET SİTESİ KULLANIM KOŞULLARI",
] as const;

export type LegalFixtureCandidate = { title: string; publishedBy: string | null };

/**
 * Case-folds the title for marker matching.
 *
 * NOTE: this must NOT use toLocaleUpperCase("tr"). In Turkish casing, "i" uppercases to "İ", so
 * "PREVIEW TEST" would fold to "PREVİEW TEST" and never match the ASCII marker - silently disabling
 * fixture detection for any row whose title is re-entered in lower case. toUpperCase() is
 * locale-independent and keeps "i" -> "I", which is what these ASCII markers expect.
 */
function foldForMarkerMatch(title: string): string {
  return title.toUpperCase();
}

/** True only for a verified legacy fixture row. Pure, so the classification is unit-testable. */
export function isLegacyLegalFixture(row: LegalFixtureCandidate): boolean {
  const title = foldForMarkerMatch(row.title);
  if (LEGACY_FIXTURE_TITLE_MARKERS.some((marker) => title.includes(marker))) return true;
  return row.publishedBy !== null && (LEGACY_FIXTURE_PUBLISHERS as readonly string[]).includes(row.publishedBy);
}

/**
 * Splits versions into the ones the admin list should show and the legacy fixtures it hides.
 * A fixture is NEVER dropped from `all`, so the toggle can always bring the history back and the
 * hidden count can be reported honestly.
 */
export function partitionLegalVersions<T extends LegalFixtureCandidate>(versions: readonly T[]): { visible: T[]; hidden: T[] } {
  const visible: T[] = [];
  const hidden: T[] = [];
  for (const version of versions) (isLegacyLegalFixture(version) ? hidden : visible).push(version);
  return { visible, hidden };
}

/** Hiding is a Preview-only affordance. Production returns the full history, always. */
export function legacyFixtureHidingActive(appEnv: string | undefined): boolean {
  return appEnv === "preview";
}
