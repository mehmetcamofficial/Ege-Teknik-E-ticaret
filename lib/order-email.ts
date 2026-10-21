import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The ONE e-mail comparison for order ownership, extracted from the inline helper that
 * startPaytrPayment() already used in lib/paytr-db.ts. Behaviour is deliberately unchanged for PayTR:
 *
 *   trim -> toLocaleLowerCase("tr") -> SHA-256 -> timingSafeEqual
 *
 * Turkish locale folding matters here: "I" and "ı" are distinct letters in tr, and a customer who typed
 * "Ada@Istanbul.com" must still match the same address typed as "ada@istanbul.com". Trimming and
 * case-folding are the whole of it - there is no fuzzy matching, no plus-addressing or dot-stripping, so
 * two genuinely different addresses never match.
 *
 * Comparing digests instead of the strings themselves keeps the comparison constant-time, so the answer
 * cannot leak how many leading characters were correct.
 *
 * Pure and dependency-free: the server routes, the pure domain layer and plain `node --test` all import
 * this one module, so there is exactly one definition of "the same e-mail" in the codebase.
 */
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

export const sameOrderEmail = (a: string, b: string): boolean =>
  timingSafeEqual(digest(a.trim().toLocaleLowerCase("tr")), digest(b.trim().toLocaleLowerCase("tr")));