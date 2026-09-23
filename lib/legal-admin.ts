import { z } from "zod";

/** Documents the storefront may need. The admin can start a first draft only for these slugs. */
export const LEGAL_DOCUMENT_SLUGS = ["distance-sales", "pre-information", "kvkk", "privacy", "cookies", "delivery-returns", "terms"] as const;

export const legalDraftSchema = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().min(10).max(25_000),
});
export const legalDraftPatchSchema = legalDraftSchema.partial().refine((value) => Object.keys(value).length > 0, "Nothing to update");

/** An explicit ISO-8601 instant with offset (e.g. 2026-10-01T00:00:00+03:00 or ...Z). */
export const legalPublishSchema = z.object({ effectiveAt: z.string().datetime({ offset: true }) });

export type AdminLegalVersionRow = {
  id: string; version: number; title: string; contentHash: string;
  effectiveAt: Date | null; publishedAt: Date | null; publishedBy: string | null;
};
export type AdminLegalStatus = "draft" | "scheduled" | "effective" | "superseded";

/**
 * Status is always derived, never stored. `rows` = all versions of the same document.
 * draft: no published_at | scheduled: published, effective_at in the future
 * effective: published, effective, and the highest such version | superseded: effective but a higher one is effective too
 */
export function deriveLegalStatus(row: AdminLegalVersionRow, rows: readonly AdminLegalVersionRow[], now: Date): AdminLegalStatus {
  if (row.publishedAt === null) return "draft";
  if (row.effectiveAt === null || row.effectiveAt > now) return "scheduled";
  const superseded = rows.some((other) => other.version > row.version && other.publishedAt !== null && other.publishedAt <= now && other.effectiveAt !== null && other.effectiveAt <= now);
  return superseded ? "superseded" : "effective";
}

/** Publishing a retroactive effective date would rewrite what was in force; a small clock tolerance is allowed. */
export const EFFECTIVE_AT_PAST_TOLERANCE_MS = 10 * 60 * 1000;
export const EFFECTIVE_AT_MAX_FUTURE_MS = 5 * 365 * 24 * 60 * 60 * 1000;
export function validateEffectiveAt(effectiveAt: Date, now: Date): { ok: true } | { ok: false; error: string } {
  if (Number.isNaN(effectiveAt.getTime())) return { ok: false, error: "Geçersiz yürürlük tarihi." };
  if (effectiveAt.getTime() < now.getTime() - EFFECTIVE_AT_PAST_TOLERANCE_MS) return { ok: false, error: "Yürürlük tarihi geçmişte olamaz." };
  if (effectiveAt.getTime() > now.getTime() + EFFECTIVE_AT_MAX_FUTURE_MS) return { ok: false, error: "Yürürlük tarihi çok ileri bir tarih." };
  return { ok: true };
}

export type LegalAuditAction = "LEGAL_VERSION_CREATED" | "LEGAL_VERSION_PUBLISHED" | "LEGAL_DRAFT_UPDATED" | "LEGAL_DRAFT_DELETED";
