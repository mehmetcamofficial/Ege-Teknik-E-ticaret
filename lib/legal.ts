import { createHash } from "node:crypto";

/**
 * Canonical form of a legal document, hashed for immutable versioning:
 *  - Unicode NFC normalization
 *  - line endings normalized to "\n" (CRLF / CR -> LF)
 *  - trailing whitespace stripped from every line
 *  - leading/trailing blank lines removed
 * The title and body are joined as `${title}\n\n${body}` after each is canonicalized.
 * Any other change (wording, inner spacing, case) is meaningful and changes the hash.
 */
export function canonicalizeLegalText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/u, ""))
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

export function canonicalizeLegalDocument(input: { title: string; body: string }): string {
  return `${canonicalizeLegalText(input.title)}\n\n${canonicalizeLegalText(input.body)}`;
}

/** SHA-256 (lowercase hex) of the canonical document content. */
export function hashLegalDocument(input: { title: string; body: string }): string {
  return createHash("sha256").update(canonicalizeLegalDocument(input), "utf8").digest("hex");
}

/** Legal documents that must be accepted at checkout. Their texts are published separately (Phase 3B.3). */
export const CHECKOUT_LEGAL_SLUGS = ["distance-sales", "pre-information"] as const;

/**
 * Informational documents that must be PUBLISHED before an order can be taken but are never a checkbox:
 * the KVKK disclosure is given at the point of data collection; it is not a consent (and never bundled with one).
 */
export const CHECKOUT_NOTICE_SLUGS = ["kvkk"] as const;
export function missingNoticeSlugs(currentSlugs: readonly string[], required: readonly string[] = CHECKOUT_NOTICE_SLUGS): string[] {
  return required.filter((slug) => !currentSlugs.includes(slug));
}

export type LegalVersionRow = { id: string; slug: string; version: number; title: string; effectiveAt: Date; publishedAt: Date };
export type RequiredLegalVersion = { slug: string; title: string; versionId: string };

/**
 * Deterministic rule: a version is applicable once it is both published and effective
 * (`publishedAt <= now` and `effectiveAt <= now`); the highest applicable `version` per slug wins.
 * Future-dated versions therefore cannot satisfy checkout.
 */
export function selectRequiredLegalVersions(rows: readonly LegalVersionRow[], now: Date, slugs: readonly string[] = CHECKOUT_LEGAL_SLUGS):
  { ok: true; required: RequiredLegalVersion[] } | { ok: false; missing: string[] } {
  const required: RequiredLegalVersion[] = [];
  const missing: string[] = [];
  for (const slug of slugs) {
    const current = rows
      .filter((row) => row.slug === slug && row.publishedAt <= now && row.effectiveAt <= now)
      .sort((a, b) => b.version - a.version)[0];
    if (current) required.push({ slug, title: current.title, versionId: current.id });
    else missing.push(slug);
  }
  return missing.length ? { ok: false, missing } : { ok: true, required };
}

export type LegalAcceptanceCheck = { ok: true } | { ok: false; code: "LEGAL_ACCEPTANCE_REQUIRED" | "LEGAL_VERSION_MISMATCH" };

/**
 * The submitted ids must equal the server-determined required version ids exactly:
 * fewer => acceptance missing; any unknown, stale, unpublished or extra id => version mismatch.
 */
export function checkLegalAcceptance(required: readonly RequiredLegalVersion[], submittedIds: readonly string[]): LegalAcceptanceCheck {
  const requiredIds = new Set(required.map((v) => v.versionId));
  if (submittedIds.some((id) => !requiredIds.has(id))) return { ok: false, code: "LEGAL_VERSION_MISMATCH" };
  if (new Set(submittedIds).size !== requiredIds.size) return { ok: false, code: "LEGAL_ACCEPTANCE_REQUIRED" };
  return { ok: true };
}

export type PublicLegalVersion = LegalVersionRow & { body: string; contentHash: string };
export type LegalVersionStatus = "effective" | "scheduled" | "superseded";
export type PublicLegalResolution =
  | { ok: true; version: PublicLegalVersion; status: LegalVersionStatus }
  | { ok: false; reason: "not_found" | "version_not_found" };

const isPublished = (row: LegalVersionRow, now: Date) => row.publishedAt <= now;

/**
 * Resolves what a public visitor may see for ONE document's versions (`rows` = all versions of the slug).
 * - Only published versions are ever visible; unpublished ids behave exactly like unknown ids.
 * - No requested id: the current version (published and effective, highest version) - same rule as checkout.
 * - A requested id is returned as-is or rejected; it is NEVER replaced by a newer/other version.
 */
export function resolvePublicLegalVersion(rows: readonly PublicLegalVersion[], requestedVersionId: string | null, now: Date): PublicLegalResolution {
  const published = rows.filter((row) => isPublished(row, now));
  const current = published.filter((row) => row.effectiveAt <= now).sort((a, b) => b.version - a.version)[0];
  if (requestedVersionId === null) return current ? { ok: true, version: current, status: "effective" } : { ok: false, reason: "not_found" };
  const version = published.find((row) => row.id === requestedVersionId);
  if (!version) return { ok: false, reason: published.length ? "version_not_found" : "not_found" };
  const status: LegalVersionStatus = version.effectiveAt > now ? "scheduled" : version.id === current?.id ? "effective" : "superseded";
  return { ok: true, version, status };
}

/** Current published version per slug, for the public legal index (metadata only, never bodies). */
export function selectCurrentLegalVersions(rows: readonly LegalVersionRow[], now: Date): { slug: string; title: string; versionId: string }[] {
  const best = new Map<string, LegalVersionRow>();
  for (const row of rows) {
    if (!isPublished(row, now) || row.effectiveAt > now) continue;
    const held = best.get(row.slug);
    if (!held || row.version > held.version) best.set(row.slug, row);
  }
  return [...best.values()].sort((a, b) => a.slug.localeCompare(b.slug)).map((row) => ({ slug: row.slug, title: row.title, versionId: row.id }));
}

/** Exact-version public URL: opens precisely the accepted version, even after a newer one is published. */
export function legalVersionPath(slug: string, versionId: string): string {
  return `/legal/${encodeURIComponent(slug)}?version=${encodeURIComponent(versionId)}`;
}
