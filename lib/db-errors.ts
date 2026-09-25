/**
 * The real PostgreSQL error code (e.g. "23505", "23503", "23514"), from either a direct `pg`
 * driver error or one drizzle-orm has wrapped in its own DrizzleQueryError. Returns undefined for
 * anything else - a non-database error, or a database error with no code - and never throws.
 *
 * drizzle-orm (0.45.x) wraps every driver error thrown by an awaited query in a DrizzleQueryError,
 * which does not itself expose `.code` - the underlying `pg` error (which does carry `.code`) is
 * nested at `.cause`. Checking `error.code` directly on a caught error therefore always reads
 * `undefined` for a query run through drizzle, silently missing every comparison. Verified against
 * real PostgreSQL: this exact pattern made a foreign-key-violation retry in lib/analytics-db.ts and
 * a verified-purchase/moderation-conflict retry in lib/reviews-db.ts both never fire (Phase 6A.1,
 * Phase 5A hotfix).
 */
export function pgErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === "object") {
    const wrapped = (cause as { code?: unknown }).code;
    if (typeof wrapped === "string") return wrapped;
  }
  return undefined;
}
