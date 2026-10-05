import { LEGAL_TEMPLATE_TOKENS } from "./legal-template.ts";

/**
 * P2-FIXTURE-A — the authoritative legal-fixture containment boundary.
 *
 * WHY THIS IS CODE-OWNED AND ID-BASED. The Preview inventory (2026-10-04) holds 16 legal versions: 7 real RC
 * documents and 9 legacy fixture rows. Every one of those 9 fixture rows is PUBLISHED and EFFECTIVE, so under the
 * selection rule ("published AND effective, highest version per slug wins") two slugs resolve to fixture content
 * today: `cookies` -> fixture v3, `terms` -> pg-test-3b3-ver-1. Fixture content was previously distinguished from
 * real legal content only by title markers and `published_by` strings, and that distinction was consulted at exactly
 * one place - the admin list - so nothing stopped a fixture from being served to a real customer.
 *
 * THE RULE THIS MODULE ENFORCES: an immutable version id is the ONLY security boundary. Titles, bodies,
 * `published_by` and version numbers are consistency evidence and can never grant fixture authority, because the
 * inventory proved both failure modes the heuristics miss:
 *   - `preview-test-ver-distance-sales-1` and `preview-test-ver-pre-information-1` share the exact title AND publisher
 *     of their v2 rows, so the historical (title, publisher) deduplication in tests/legacy-legal-fixtures.test.ts
 *     silently lost 2 of the 9 fixtures. Reproducing that model would have left 2 fixtures uncontained.
 *   - 4 fixtures were written by actor uuid `e7c9a5ef-adf0-4d65-84a6-6dc92c4fe72c`, which is NOT one of the
 *     publisher sentinels, so `published_by` matching alone recognises only 5 of the 9.
 */

/**
 * The complete, verified legacy fixture inventory as immutable legal_document_versions.id values.
 * Discovered by SELECT-only audit of the Preview branch br-nameless-mountain-awib28a9 on 2026-10-04 and reconciled
 * against the canonical source registry. Sorted for determinism. This array IS the boundary: a row is a fixture
 * because its id is here, and nothing else.
 */
export const LEGACY_FIXTURE_VERSION_IDS: readonly string[] = Object.freeze([
  "22826878-973e-4c0d-912c-6700ace0e843", // cookies v3  - admin test, future-effective
  "69ffd5c6-b930-4300-a183-878c99a5d02c", // cookies v1  - admin test, carries an <script>alert(1)</script> probe
  "c58b9077-dd52-4f32-bf3f-1dca51ba471e", // kvkk v1     - preview KVKK fixture
  "f62b7e17-98dc-48e4-8630-c2fffbfe6fa8", // cookies v2  - admin test
  "pg-test-3b3-ver-1", // terms v1  - postgres integration fixture
  "preview-test-ver-distance-sales-1", // distance-sales v1 - LOST by title/publisher dedup
  "preview-test-ver-distance-sales-2", // distance-sales v2 - active Preview checkout authority
  "preview-test-ver-pre-information-1", // pre-information v1 - LOST by title/publisher dedup
  "preview-test-ver-pre-information-2", // pre-information v2 - active Preview checkout authority
]);

const LEGACY_FIXTURE_ID_SET = new Set(LEGACY_FIXTURE_VERSION_IDS);

/**
 * Metadata the Preview audit recorded for each registered fixture. Used ONLY to detect registry drift: if a row that
 * is supposed to be fixture X now carries different identity, the registry and the database disagree and we fail
 * closed rather than silently reclassify. Never used to decide that something IS a fixture.
 */
export const LEGACY_FIXTURE_EXPECTATIONS: Readonly<Record<string, { slug: string; version: number; publishedBy: string | null; contentHash: string | null }>> =
  Object.freeze({
    "22826878-973e-4c0d-912c-6700ace0e843": { slug: "cookies", version: 3, publishedBy: "e7c9a5ef-adf0-4d65-84a6-6dc92c4fe72c", contentHash: "286921dfb7a5" },
    "69ffd5c6-b930-4300-a183-878c99a5d02c": { slug: "cookies", version: 1, publishedBy: "e7c9a5ef-adf0-4d65-84a6-6dc92c4fe72c", contentHash: "c962fa755b09" },
    "c58b9077-dd52-4f32-bf3f-1dca51ba471e": { slug: "kvkk", version: 1, publishedBy: "e7c9a5ef-adf0-4d65-84a6-6dc92c4fe72c", contentHash: "82a3d0b63d0e" },
    "f62b7e17-98dc-48e4-8630-c2fffbfe6fa8": { slug: "cookies", version: 2, publishedBy: "e7c9a5ef-adf0-4d65-84a6-6dc92c4fe72c", contentHash: "e1e6c76d0754" },
    "pg-test-3b3-ver-1": { slug: "terms", version: 1, publishedBy: "pg-test-3b3-script", contentHash: "testhash2" },
    "preview-test-ver-distance-sales-1": { slug: "distance-sales", version: 1, publishedBy: "preview-fixture-script", contentHash: "2a3176077662" },
    "preview-test-ver-distance-sales-2": { slug: "distance-sales", version: 2, publishedBy: "preview-fixture-script", contentHash: "2a3176077662" },
    "preview-test-ver-pre-information-1": { slug: "pre-information", version: 1, publishedBy: "preview-fixture-script", contentHash: "b3dba9b9b170" },
    "preview-test-ver-pre-information-2": { slug: "pre-information", version: 2, publishedBy: "preview-fixture-script", contentHash: "b3dba9b9b170" },
  });

/** The exact, server-owned Preview branch the fixture inventory was verified against. */
export const VERIFIED_PREVIEW_NEON_BRANCH_ID = "br-nameless-mountain-awib28a9";

export const VERIFIED_PREVIEW_APP_ENV = "preview";
export type LegalVersionClassification = "ordinary" | "legacy_fixture" | "reserved_preview_fixture";

/**
 * P2-FIXTURE-B — the code-owned body of the reserved Preview render fixture.
 *
 * WHY THE BODY LIVES IN CODE. This fixture exists to prove that the REAL renderer and the REAL substitution path
 * behave correctly in a REAL browser. Its body therefore must never come from, or resemble, real legal text: it must
 * be impossible to mistake for customer legal content, and impossible to publish as such. Owning the body here means
 * (a) no legal draft is touched, (b) no RC document is copied or republished, and (c) the exact bytes under test are
 * reviewable in a diff rather than living in a database row nobody reads.
 *
 * The body deliberately uses the COMPLETE canonical token set - all 13 tokens from LEGAL_TEMPLATE_TOKENS - so one
 * document exercises every branch of the renderer's substitution contract: text, integer amounts, an array of order
 * lines, and a date.
 *
 * This is NOT legal publication, NOT a draft, and NOT Production preparation.
 */
export const RESERVED_PREVIEW_FIXTURE_BODY = [
  "PREVIEW RENDER TEST — NOT LEGAL TEXT — TEST FIXTURE",
  "Bu metin hukuki metin DEĞİLDİR. Yalnızca ön izleme ortamında şablon değişkeni testi için kullanılır.",
  "",
  "Müşteri: {{ALICI_AD_SOYAD}}",
  "E-posta: {{ALICI_EPOSTA}}",
  "Telefon: {{ALICI_TELEFON}}",
  "Teslimat adresi: {{TESLIMAT_ADRESI}}",
  "Teslimat yöntemi: {{TESLIMAT_YONTEMI}}",
  "Sipariş no: {{SIPARIS_NO}}",
  "Sipariş tarihi: {{SIPARIS_TARIHI}}",
  "Ürün satırları: {{URUN_SATIRLARI}}",
  "Ara toplam: {{URUN_TOPLAMI}}",
  "Toplam tutar: {{TOPLAM_TUTAR}}",
  "Kargo ücreti: {{KARGO_UCRETI}}",
  "Diğer ek masraflar: {{DIGER_EK_MASRAFLAR}}",
  "Fatura bilgileri: {{FATURA_BILGILERI}}",
].join("\n");

/**
 * The token set the reserved fixture body actually references. Exported so a test can prove the body and the
 * canonical allow-list can never drift apart in either direction.
 */
export const RESERVED_PREVIEW_FIXTURE_TOKENS = LEGAL_TEMPLATE_TOKENS;

/** A title that can never be mistaken for, or promoted into, a real legal document title. */
export const RESERVED_PREVIEW_FIXTURE_TITLE = "PREVIEW RENDER TEST — NOT LEGAL TEXT";

/** The two EXACT, approved reserved fixture ids. This list is the only authority - not a prefix, not any heuristic. */
export const RESERVED_PREVIEW_FIXTURE_VERSION_IDS: readonly string[] = Object.freeze([
  "p2-preview-fixture-distance-sales-render-1",
  "p2-preview-fixture-pre-information-render-1",
]);

const RESERVED_ID_SET = new Set(RESERVED_PREVIEW_FIXTURE_VERSION_IDS);

/** Deterministic code-owned metadata. No DB row exists for any of this, so every value is derived here. */
export const RESERVED_PREVIEW_FIXTURE_VERSIONS: Readonly<Record<string, { slug: string; version: number; title: string }>> = Object.freeze({
  "p2-preview-fixture-distance-sales-render-1": { slug: "distance-sales", version: 4, title: RESERVED_PREVIEW_FIXTURE_TITLE },
  "p2-preview-fixture-pre-information-render-1": { slug: "pre-information", version: 4, title: RESERVED_PREVIEW_FIXTURE_TITLE },
});

/**
 * P2-FIXTURE-B: the code-owned reserved Preview fixtures, and the ONLY gate that may serve them.
 *
 * There is deliberately NO database row for these. They are not published, they carry no publication lifecycle, and
 * they occupy no version ordering: `version` above is a presentation field only, used to satisfy the shape the
 * checkout loaders return, NOT to compete in the DB's "highest published version wins" rule. Because nothing in the
 * database selects them, they can never be reached by any other code path - not the public index, not the public
 * exact-version route, not the admin history, not the historical accepted-document loader.
 *
 * Serving them is therefore a decision made in exactly one place, `reservedPreviewCheckoutDocuments` below, and it
 * requires the FULL verified Preview identity. Anywhere else they do not exist.
 */
export function reservedPreviewCheckoutDocuments(env: Record<string, string | undefined>): { versionId: string; slug: string; title: string; version: number; body: string }[] | null {
  if (!hasVerifiedPreviewFixtureIdentity(env)) return null;
  return RESERVED_PREVIEW_FIXTURE_VERSION_IDS.map((versionId) => ({
    versionId,
    slug: RESERVED_PREVIEW_FIXTURE_VERSIONS[versionId].slug,
    title: RESERVED_PREVIEW_FIXTURE_VERSIONS[versionId].title,
    version: RESERVED_PREVIEW_FIXTURE_VERSIONS[versionId].version,
    body: RESERVED_PREVIEW_FIXTURE_BODY,
  }));
}

/** The ids a submitted acceptance set must equal, in verified Preview. Null everywhere else. */
export const reservedPreviewAcceptanceVersionIds = (env: Record<string, string | undefined>): string[] | null =>
  hasVerifiedPreviewFixtureIdentity(env) ? [...RESERVED_PREVIEW_FIXTURE_VERSION_IDS] : null;

/**
 * Is this a reserved fixture id? EXACT membership only.
 *
 * The namespace prefix is NOT authority: a row id that merely looks reserved but is not one of the two approved ids
 * is rejected, so a lookalike cannot be used to slip fixture content past the boundary.
 */
export function isReservedPreviewFixtureVersionId(id: string): boolean {
  return RESERVED_ID_SET.has(id);
}

/** Exact membership: a lookalike id that merely resembles the namespace is NOT reserved. */
export function isReservedPreviewFixtureId(id: string): boolean {
  return RESERVED_ID_SET.has(id);
}

/** Namespace resemblance is anomaly evidence ONLY: it rejects, never grants authority. */
function isUnapprovedReservedFixtureId(id: string): boolean {
  return id.startsWith("p2-preview-fixture-") && !isReservedPreviewFixtureId(id);
}

/** The row shape the classifier needs. Deliberately minimal so every loader can supply it. */
export type ClassifiableLegalVersion = { id: string };

/**
 * THE authoritative classifier. Identity-only and total: it never throws, never inspects text, and never invents
 * authority. `reserved_preview_fixture` is deliberately NOT part of Phase A - it belongs to Phase B, when a reserved
 * fixture actually exists and therefore has a real id to key on.
 */
export function classifyLegalVersion(row: ClassifiableLegalVersion): LegalVersionClassification {
  if (LEGACY_FIXTURE_ID_SET.has(row.id)) return "legacy_fixture";
  // P2-FIXTURE-B: EXACT id membership only. A prefix match would let any lookalike id claim reserved status.
  if (RESERVED_ID_SET.has(row.id)) return "reserved_preview_fixture";
  return "ordinary";
}

export const isLegacyLegalFixtureVersionId = (id: string): boolean => LEGACY_FIXTURE_ID_SET.has(id);

/**
 * Registry drift check. A registered fixture whose recorded identity no longer matches the row it is attached to means
 * the registry and the database have diverged - the row may have been re-slugged, re-versioned or swapped. That is
 * never downgraded to `ordinary`; it is reported so the caller can fail closed.
 */
export function legacyFixtureExpectationDrift(
  row: ClassifiableLegalVersion & { slug?: string; version?: number; publishedBy?: string | null; contentHash?: string | null },
): string | null {
  const expected = LEGACY_FIXTURE_EXPECTATIONS[row.id];
  if (!expected) return null;
  if (row.slug !== undefined && row.slug !== expected.slug) return `slug ${row.slug} != ${expected.slug}`;
  if (row.version !== undefined && row.version !== expected.version) return `version ${row.version} != ${expected.version}`;
  if (row.publishedBy !== undefined && row.publishedBy !== expected.publishedBy) return `publishedBy ${row.publishedBy} != ${expected.publishedBy}`;
  // Content hash is compared on prefix only; the registry stores the audited prefix, not the full digest.
  if (row.contentHash !== undefined && expected.contentHash && !String(row.contentHash).startsWith(expected.contentHash)) {
    return `contentHash ${String(row.contentHash).slice(0, 12)} != ${expected.contentHash}`;
  }
  return null;
}

/**
 * Server-owned Preview identity. Exact equality on every condition, no normalisation, no trimming and no coercion:
 * a malformed value must fail closed rather than be "helpfully" accepted. Deliberately NOT derived from hostname,
 * VERCEL_ENV, request headers or client input - a request-supplied signal would let a caller opt itself into the
 * fixture branch.
 */
export function hasVerifiedPreviewFixtureIdentity(env: Record<string, string | undefined>): boolean {
  return (
    env.APP_ENV === VERIFIED_PREVIEW_APP_ENV &&
    env.NEON_BRANCH_ID === VERIFIED_PREVIEW_NEON_BRANCH_ID &&
    env.EXPECTED_NEON_PREVIEW_BRANCH_ID === env.NEON_BRANCH_ID
  );
}

export type LegalFixtureContamination = {
  /** Every registered fixture present in the inventory that could not be justified by the running identity. */
  readonly offendingVersionIds: readonly string[];
  /** Registry entries that drifted from their recorded identity; empty when the registry and DB agree. */
  readonly driftedVersionIds: readonly string[];
  /** P2-FIXTURE-B: reserved Preview fixtures found outside the verified identity. Reported separately from legacy. */
  readonly reservedOffendingVersionIds: readonly string[];
};

/**
 * THE boundary check. Call it with the COMPLETE legal version inventory - every version of every slug, before any
 * published/effective/slug/highest-version filtering. Filtering first would let a fixture hide behind being
 * superseded, future-effective, on a non-checkout slug, or shadowed by an ordinary version, and containment would
 * silently stop covering exactly the rows that need it.
 */
export function inspectLegalFixtureContamination(
  inventory: readonly (ClassifiableLegalVersion & { slug?: string; version?: number; publishedBy?: string | null; contentHash?: string | null })[],
  env: Record<string, string | undefined>,
): LegalFixtureContamination {
  const drifted: string[] = [];
  const present: string[] = [];
  const reservedPresent: string[] = [];
  const unapprovedReserved: string[] = [];
  for (const row of inventory) {
    if (isUnapprovedReservedFixtureId(row.id)) {
      unapprovedReserved.push(row.id);
      continue;
    }
    if (isReservedPreviewFixtureId(row.id)) {
      reservedPresent.push(row.id);
      continue;
    }
    if (!LEGACY_FIXTURE_ID_SET.has(row.id)) continue;
    present.push(row.id);
    const drift = legacyFixtureExpectationDrift(row);
    if (drift) drifted.push(`${row.id} (${drift})`);
  }
  const verifiedPreview = hasVerifiedPreviewFixtureIdentity(env);
  // Registry drift is itself a fail-closed condition regardless of environment: we cannot reason about a boundary
  // whose members we can no longer identify.
  if (drifted.length) return { offendingVersionIds: LEGACY_FIXTURE_VERSION_IDS, driftedVersionIds: drifted, reservedOffendingVersionIds: [...reservedPresent, ...unapprovedReserved] };
  // P2-FIXTURE-B: a reserved fixture is servable ONLY under the verified Preview identity. Outside it, a reserved
  // fixture is contamination exactly like a legacy one. There is deliberately NO fallback to an ordinary version of
  // the same slug: falling back would silently serve different legal text than the operator selected.
  return {
    offendingVersionIds: verifiedPreview ? [] : present,
    driftedVersionIds: [],
    reservedOffendingVersionIds: verifiedPreview ? unapprovedReserved : [...reservedPresent, ...unapprovedReserved],
  };
}

export const isLegalFixtureContaminated = (report: LegalFixtureContamination): boolean =>
  report.driftedVersionIds.length > 0 || report.offendingVersionIds.length > 0 || report.reservedOffendingVersionIds.length > 0;
