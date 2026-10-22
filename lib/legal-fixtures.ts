import { isLegacyLegalFixtureVersionId } from "./legal-fixture-registry.ts";

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

/** Identities the fixture scripts wrote into `published_by`. Verifiable, but NOT sufficient on their own. */
export const LEGACY_FIXTURE_PUBLISHERS = ["preview-fixture-script", "pg-test-3b3-script"] as const;

/**
 * P2-FIXTURE-A: the admin list now classifies by the authoritative immutable-id registry, not by this heuristic.
 *
 * The heuristic was wrong in both directions. It MISSED `preview-test-ver-distance-sales-1` and
 * `preview-test-ver-pre-information-1` (they share the exact title and publisher of their v2 rows, so the
 * (title, publisher) model deduplicated them away), and it also matched on title text, so a legitimate real document
 * whose title happened to contain a marker could be hidden. The markers below are therefore retained ONLY as a
 * drift/anomaly signal for rows that are NOT in the registry - never as a grant of fixture status.
 */
export const LEGACY_FIXTURE_TITLE_MARKERS = ["PHASE 3B.3", "PREVIEW TEST", "NOT LEGAL TEXT", "DO NOT COPY TO PRODUCTION"] as const;

/** Title/publisher evidence for a row that is NOT in the authoritative registry. Diagnostic only - never authoritative. */
export function hasLegacyFixtureMarkerEvidence(row: LegalFixtureCandidate): boolean {
  const title = row.title.toUpperCase();
  if (LEGACY_FIXTURE_TITLE_MARKERS.some((marker) => title.includes(marker))) return true;
  return row.publishedBy !== null && (LEGACY_FIXTURE_PUBLISHERS as readonly string[]).includes(row.publishedBy);
}

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
 * P2-FIXTURE-A: identity-authoritative. A row is a fixture because its immutable id is in the registry.
 *
 * `title` is retained on the input type for compatibility with existing callers and for marker-based DRIFT
 * reporting, but it is no longer consulted to decide classification.
 */
export function isLegacyLegalFixture(row: LegalFixtureCandidate & { id?: string }): boolean {
  return row.id !== undefined && isLegacyLegalFixtureVersionId(row.id);
}

/**
 * Splits versions into the ones the admin list should show and the legacy fixtures it hides.
 * A fixture is NEVER dropped from `all`, so the toggle can always bring the history back and the
 * hidden count can be reported honestly.
 */
export function partitionLegalVersions<T extends LegalFixtureCandidate & { id?: string }>(versions: readonly T[]): { visible: T[]; hidden: T[] } {
  const visible: T[] = [];
  const hidden: T[] = [];
  for (const version of versions) (isLegacyLegalFixture(version) ? hidden : visible).push(version);
  return { visible, hidden };
}

/** Hiding is a Preview-only affordance. Production returns the full history, always. */
export function legacyFixtureHidingActive(appEnv: string | undefined): boolean {
  return appEnv === "preview";
}
