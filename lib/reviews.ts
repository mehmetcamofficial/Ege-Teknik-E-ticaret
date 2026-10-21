import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Customer reviews (Phase 5A) - pure domain logic, no DB or framework imports.
 *
 * Invariants:
 * - The client never controls status, verification or moderation: the request schema is
 *   strict, so `verified`, `verifiedPurchase`, `orderItemId`, `status` ... are rejected.
 * - Verification is derived server-side from an order lookup (see reviews-db.ts) and the
 *   database re-checks it in the product_reviews guard trigger.
 * - Public output goes through toPublicReview, an allow-list - never a row spread.
 */

export const reviewStatuses = ["pending", "approved", "rejected"] as const;
export type ReviewStatus = (typeof reviewStatuses)[number];
export const reviewSorts = ["newest", "highest", "lowest"] as const;
export type ReviewSort = (typeof reviewSorts)[number];
/** Order statuses that prove the customer actually received the product (approved decision 1). */
export const VERIFIABLE_ORDER_STATUSES = ["delivered", "installation", "completed"] as const;

export const REVIEW_LIMITS = { nameMin: 2, nameMax: 40, bodyMin: 10, bodyMax: 2000, noteMax: 500, pageDefault: 10, pageMax: 20, maxRequestBytes: 8_000 } as const;
export const REVIEW_RATE_LIMITS = { hourly: { scope: "review", limit: 5, windowMs: 60 * 60 * 1000 }, daily: { scope: "review-day", limit: 20, windowMs: 24 * 60 * 60 * 1000 } } as const;

// Invisible / direction-changing characters that could disguise text; control characters except tab/newline (tabs collapse to spaces).
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u00AD]/g;
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|tr|io|co|info|biz|xyz|ru)\b)/i;
const EMAIL_LIKE = /\S+@\S+/;
const PHONE_LIKE = /(\d[\s().-]*){7,}/;

/** Plain text only: NFC, no invisible/control characters, tidy whitespace, at most one blank line in a row. */
export function normalizeReviewText(value: string): string {
  return value.normalize("NFC").replace(/\r\n?/g, "\n").replace(INVISIBLE, "").replace(CONTROL, "")
    .split("\n").map((line) => line.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
export function normalizeDisplayName(value: string): string {
  return normalizeReviewText(value).replace(/\s+/g, " ");
}

const displayName = z.string().max(200).transform(normalizeDisplayName).pipe(
  z.string().min(REVIEW_LIMITS.nameMin, "Görünecek ad en az 2 karakter olmalı.").max(REVIEW_LIMITS.nameMax, "Görünecek ad en fazla 40 karakter olabilir.")
    .refine((v) => !EMAIL_LIKE.test(v) && !PHONE_LIKE.test(v), "Görünecek ada e-posta veya telefon yazmayın.")
    .refine((v) => !LINK.test(v), "Görünecek ad bağlantı içeremez."),
);
const body = z.string().max(REVIEW_LIMITS.bodyMax * 2).transform(normalizeReviewText).pipe(
  z.string().min(REVIEW_LIMITS.bodyMin, "Yorum en az 10 karakter olmalı.").max(REVIEW_LIMITS.bodyMax, "Yorum en fazla 2000 karakter olabilir.")
    .refine((v) => !LINK.test(v), "Yorum bağlantı içeremez."),
);
const orderNumber = z.string().max(40).transform((v) => v.trim().toUpperCase()).pipe(z.string().regex(/^ETS-\d{8}-[0-9A-F]{6}$/, "Sipariş numarası ETS-YYYYAAGG-XXXXXX biçiminde olmalı."));
const contact = z.string().max(150).transform((v) => v.trim()).pipe(z.string().min(5, "Telefon veya e-posta girin."));

/** Strict: any unknown field (verified, verifiedPurchase, orderItemId, status, moderation...) fails validation. */
export const reviewSubmissionSchema = z.object({
  rating: z.number({ invalid_type_error: "Puan seçin." }).int("Puan tam sayı olmalı.").min(1, "Puan 1 ile 5 arasında olmalı.").max(5, "Puan 1 ile 5 arasında olmalı."),
  displayName,
  body,
  orderNumber: orderNumber.optional(),
  contact: contact.optional(),
  /** Honeypot: humans never see or fill it. A filled value is accepted and silently dropped. */
  website: z.string().max(200).optional(),
}).strict().superRefine((v, ctx) => {
  if (Boolean(v.orderNumber) !== Boolean(v.contact)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [v.orderNumber ? "contact" : "orderNumber"], message: "Doğrulama için sipariş numarası ile telefon veya e-postayı birlikte girin." });
});
export type ReviewSubmission = z.infer<typeof reviewSubmissionSchema>;

export const reviewListQuerySchema = z.object({
  sort: z.enum(reviewSorts).default("newest"),
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(REVIEW_LIMITS.pageMax).default(REVIEW_LIMITS.pageDefault),
});

export const moderationRequestSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  note: z.string().max(REVIEW_LIMITS.noteMax * 2).transform(normalizeReviewText).pipe(z.string().max(REVIEW_LIMITS.noteMax)).optional(),
}).strict();

export const adminReviewListQuerySchema = z.object({ status: z.enum(reviewStatuses).default("pending"), cursor: z.string().max(300).optional() });

/** Field-level messages for the storefront (no values echoed back). */
export function submissionErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) { const key = String(issue.path[0] ?? "form"); if (!out[key]) out[key] = issue.code === "unrecognized_keys" ? "İstek geçersiz alanlar içeriyor." : issue.message; }
  return out;
}

/**
 * Same product + same text (case/space-insensitive) -> same hash; the live-content unique index uses it.
 * Turkish lower-casing maps ASCII "I" to dotless "ı", and a non-Turkish lower-case of "İ" leaves "i" + U+0307,
 * so every i-variant is folded to "i" afterwards; otherwise "DEĞERLENDIRME" and "değerlendirme" would hash
 * differently and bypass the duplicate check.
 */
export function reviewContentHash(normalizedBody: string): string {
  return createHash("sha256").update(normalizedBody.toLocaleLowerCase("tr").replace(/i̇/g, "i").replace(/ı/g, "i").replace(/\s+/g, " ").trim()).digest("hex");
}

// ---- verified purchase --------------------------------------------------------------------------------------
/** Phone -> last 10 digits (handles 0/+90 prefixes); e-mail -> lower-case. Null when neither form is usable. */
export function normalizeContact(value: string): { kind: "email" | "phone"; value: string } | null {
  const trimmed = value.trim();
  if (trimmed.includes("@")) { const email = trimmed.toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { kind: "email", value: email } : null; }
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 10 ? { kind: "phone", value: digits.slice(-10) } : null;
}
function sameSecret(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest(), hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length > 0;
}
export type VerifiableOrderLine = { orderItemId: string; orderStatus: string; phone: string; email: string };
/**
 * Returns the order item that proves the purchase, or null. Always performs a comparison (against an
 * empty placeholder when no order line exists) so the work done does not reveal whether the order exists.
 */
export function verifyPurchase(line: VerifiableOrderLine | null, contact: string): string | null {
  const given = normalizeContact(contact);
  const phone = normalizeContact(line?.phone ?? "")?.value ?? "", email = normalizeContact(line?.email ?? "")?.value ?? "";
  const matches = given ? sameSecret(given.value, given.kind === "email" ? email : phone) : false;
  const eligible = !!line && (VERIFIABLE_ORDER_STATUSES as readonly string[]).includes(line.orderStatus);
  return line && matches && eligible ? line.orderItemId : null;
}

// ---- moderation ---------------------------------------------------------------------------------------------
const TRANSITIONS: Record<ReviewStatus, readonly ReviewStatus[]> = { pending: ["approved", "rejected"], approved: ["rejected"], rejected: ["approved"] };
/** No transition ever returns to pending (the DB trigger enforces the same). */
export function canTransitionReview(from: string, to: string): boolean {
  return (TRANSITIONS[from as ReviewStatus] ?? []).includes(to as ReviewStatus);
}

// ---- public projection & aggregates ------------------------------------------------------------------------
export type ReviewRow = { id: string; rating: number; displayName: string; body: string; verifiedPurchase: boolean; createdAt: Date | string };
export type PublicReview = { id: string; rating: number; displayName: string; body: string; date: string; verifiedPurchase: boolean };
/** Allow-list: nothing internal (order, contact, ip hash, moderation, hashes, keys) can leak through a spread. */
export function toPublicReview(row: ReviewRow): PublicReview {
  return { id: row.id, rating: row.rating, displayName: row.displayName, body: row.body, date: new Date(row.createdAt).toISOString().slice(0, 10), verifiedPurchase: row.verifiedPurchase === true };
}
export const PUBLIC_REVIEW_KEYS = ["id", "rating", "displayName", "body", "date", "verifiedPurchase"] as const;

export type ReviewSummary = { count: number; average: number | null; distribution: Record<"5" | "4" | "3" | "2" | "1", number> };
/** From approved-only GROUP BY rating counts. Zero reviews -> count 0, average null, all buckets 0. */
export function summarizeRatings(groups: readonly { rating: number; count: number }[]): ReviewSummary {
  const distribution: ReviewSummary["distribution"] = { "5": 0, "4": 0, "3": 0, "2": 0, "1": 0 };
  let count = 0, total = 0;
  for (const { rating, count: n } of groups) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || !Number.isInteger(n) || n <= 0) continue;
    distribution[String(rating) as keyof ReviewSummary["distribution"]] += n; count += n; total += rating * n;
  }
  return { count, average: count ? Math.round((total / count) * 10) / 10 : null, distribution };
}

// ---- keyset cursor ------------------------------------------------------------------------------------------
export type ReviewCursor = { rating: number; createdAt: string; id: string };
export function encodeReviewCursor(row: { rating: number; createdAt: Date | string; id: string }): string {
  return Buffer.from(JSON.stringify({ r: row.rating, c: new Date(row.createdAt).toISOString(), i: row.id })).toString("base64url");
}
export function decodeReviewCursor(value: string | undefined): ReviewCursor | null {
  if (!value) return null;
  try {
    const raw = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { r?: unknown; c?: unknown; i?: unknown };
    if (typeof raw.r !== "number" || !Number.isInteger(raw.r) || raw.r < 1 || raw.r > 5) return null;
    if (typeof raw.c !== "string" || Number.isNaN(Date.parse(raw.c)) || typeof raw.i !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(raw.i)) return null;
    return { rating: raw.r, createdAt: new Date(raw.c).toISOString(), id: raw.i };
  } catch { return null; }
}
