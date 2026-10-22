/**
 * Admin password policy (Phase 6B): length only, plus a common/weak password block - no
 * mandated upper/lower/digit/symbol combination (length and unpredictability matter more than
 * composition rules, which mostly just push people toward predictable substitutions like "!" for
 * "1"). Pure, framework-free - reused by the reset-password route and its tests.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

// A short, curated list of passwords common enough that length alone doesn't make them safe -
// not an exhaustive breach-corpus check, just the obvious, predictable ones (English + Turkish
// site-relevant terms). Compared case-insensitively, and only ever needs to catch full matches or
// simple digit-suffixed variants (handled separately below), not partial containment.
const COMMON_PASSWORDS = [
  "password", "passw0rd", "password1", "password123", "letmein", "welcome", "welcome1",
  "qwerty", "qwerty123", "qwertyuiop", "asdfghjkl", "zxcvbnm", "admin", "administrator",
  "admin123", "adminadmin", "changeme", "changeme123", "iloveyou", "monkey", "dragon",
  "sunshine", "princess", "football", "baseball", "trustno1", "superman", "master",
  "shadow", "abc123", "abcdefgh", "abcdefghij", "123123123", "111111111", "000000000",
  "sifre", "sifre123", "parola", "parola123", "12345678", "123456789", "1234567890",
  "egeteknik", "egeteknik123", "egeteknik1", "ankara123", "istanbul123", "klima123",
];
const COMMON_SET = new Set(COMMON_PASSWORDS.map((p) => p.toLowerCase()));

/** "aaaaaaaaaaaa" or similar: a single character repeated for the entire length. */
function isSingleCharacterRepeated(password: string): boolean {
  return password.length > 0 && new Set(password).size === 1;
}
/** "123456789012", "234567890123", ...: every character one more than the last (mod 10 for digits). */
function isSequentialDigits(password: string): boolean {
  if (!/^\d+$/.test(password)) return false;
  for (let i = 1; i < password.length; i++) {
    const prev = password.charCodeAt(i - 1) - 48, cur = password.charCodeAt(i) - 48;
    if ((prev + 1) % 10 !== cur) return false;
  }
  return true;
}

export type PasswordPolicyResult = { ok: true } | { ok: false; error: string };

export function validatePasswordPolicy(password: string): PasswordPolicyResult {
  if (password.length < PASSWORD_MIN_LENGTH) return { ok: false, error: `Parola en az ${PASSWORD_MIN_LENGTH} karakter olmalı.` };
  if (password.length > PASSWORD_MAX_LENGTH) return { ok: false, error: `Parola en fazla ${PASSWORD_MAX_LENGTH} karakter olabilir.` };
  const normalized = password.trim().toLowerCase();
  if (COMMON_SET.has(normalized)) return { ok: false, error: "Bu parola çok yaygın kullanılıyor; lütfen tahmin edilmesi zor bir parola seçin." };
  if (isSingleCharacterRepeated(password)) return { ok: false, error: "Parola tek bir karakterin tekrarından oluşamaz." };
  if (isSequentialDigits(password)) return { ok: false, error: "Parola ardışık rakamlardan oluşamaz." };
  return { ok: true };
}
