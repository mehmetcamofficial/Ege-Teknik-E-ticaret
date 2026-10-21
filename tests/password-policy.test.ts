import assert from "node:assert/strict";
import test from "node:test";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, validatePasswordPolicy } from "../lib/password-policy.ts";
import { hashPassword, verifyPassword } from "../lib/password.ts";

test("length bounds are exactly 12..200, no composition rules (no forced upper/lower/digit/symbol)", () => {
  assert.equal(PASSWORD_MIN_LENGTH, 12);
  assert.equal(PASSWORD_MAX_LENGTH, 200);
  assert.equal(validatePasswordPolicy("a".repeat(11)).ok, false, "11 chars, below the minimum");
  assert.equal(validatePasswordPolicy("correct horse battery staple").ok, true, "plain lowercase + spaces, no symbols/digits, is accepted");
  assert.equal(validatePasswordPolicy("a".repeat(200)).ok, false, "200 a's is a single repeated character, rejected for that reason");
  assert.equal(validatePasswordPolicy("a".repeat(201)).ok, false);
});
test("a curated list of common/weak passwords is rejected even when long enough", () => {
  for (const bad of ["password123", "qwertyuiop", "changeme123", "egeteknik123", "adminadmin", "iloveyou", "sifre123456"]) {
    assert.equal(validatePasswordPolicy(bad).ok, false, bad);
  }
});
test("the common-password check is case-insensitive and trims whitespace", () => {
  assert.equal(validatePasswordPolicy("PASSWORD123").ok, false);
  assert.equal(validatePasswordPolicy("  password123  ").ok, false);
});
test("a single character repeated for the whole length is rejected regardless of which character", () => {
  assert.equal(validatePasswordPolicy("aaaaaaaaaaaa").ok, false);
  assert.equal(validatePasswordPolicy("111111111111").ok, false);
  assert.equal(validatePasswordPolicy("!!!!!!!!!!!!").ok, false);
});
test("purely sequential ascending digits are rejected; non-sequential and wrapping-incorrect digit runs are not", () => {
  assert.equal(validatePasswordPolicy("123456789012").ok, false);
  assert.equal(validatePasswordPolicy("234567890123").ok, false);
  assert.equal(validatePasswordPolicy("135792468013").ok, true, "not sequential");
});
test("a genuinely strong, unpredictable password is accepted", () => {
  assert.equal(validatePasswordPolicy("Kelebek-Mavisi-Deniz-93kq").ok, true);
  assert.equal(validatePasswordPolicy("correct horse battery staple 42").ok, true);
});
test("hashPassword produces the exact format verifyPassword expects, with a fresh salt every call", async () => {
  const h1 = await hashPassword("a-reasonably-strong-test-password");
  const h2 = await hashPassword("a-reasonably-strong-test-password");
  assert.match(h1, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.notEqual(h1, h2, "same password, different salt, different encoded hash");
  assert.equal(await verifyPassword("a-reasonably-strong-test-password", h1), true);
  assert.equal(await verifyPassword("a-reasonably-strong-test-password", h2), true);
  assert.equal(await verifyPassword("wrong-password", h1), false);
});
