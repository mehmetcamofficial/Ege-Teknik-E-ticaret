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
export type LegalVersionClassification = "ordinary" | "legacy_fixture";

/** The row shape the classifier needs. Deliberately minimal so every loader can supply it. */
export type ClassifiableLegalVersion = { id: string };

/**
 * THE authoritative classifier. Identity-only and total: it never throws, never inspects text, and never invents
 * authority. `reserved_preview_fixture` is deliberately NOT part of Phase A - it belongs to Phase B, when a reserved
 * fixture actually exists and therefore has a real id to key on.
 */
export function classifyLegalVersion(row: ClassifiableLegalVersion): LegalVersionClassification {
  return LEGACY_FIXTURE_ID_SET.has(row.id) ? "legacy_fixture" : "ordinary";
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
  for (const row of inventory) {
    if (!LEGACY_FIXTURE_ID_SET.has(row.id)) continue;
    present.push(row.id);
    const drift = legacyFixtureExpectationDrift(row);
    if (drift) drifted.push(`${row.id} (${drift})`);
  }
  // Registry drift is itself a fail-closed condition regardless of environment: we cannot reason about a boundary
  // whose members we can no longer identify.
  if (drifted.length) return { offendingVersionIds: LEGACY_FIXTURE_VERSION_IDS, driftedVersionIds: drifted };
  return { offendingVersionIds: hasVerifiedPreviewFixtureIdentity(env) ? [] : present, driftedVersionIds: [] };
}

export const isLegalFixtureContaminated = (report: LegalFixtureContamination): boolean =>
  report.driftedVersionIds.length > 0 || report.offendingVersionIds.length > 0;
