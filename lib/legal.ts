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
