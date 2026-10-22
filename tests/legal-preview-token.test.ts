import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { signLegalPreviewToken, verifyLegalPreviewToken, LEGAL_PREVIEW_TTL_MS, LEGAL_PREVIEW_CLOCK_SKEW_MS, type LegalPreviewTokenPayload } from "../lib/legal-preview-token.ts";
import { TEST_LEGAL_PREVIEW_SECRET } from "./support/legal-preview-harness.ts";

const NOW = 1_700_000_000_000;
const payload: LegalPreviewTokenPayload = {
  v: 1, issuedAt: NOW, expiresAt: NOW + LEGAL_PREVIEW_TTL_MS,
  orderNumber: "ETS-CANONICAL-TEST", orderIssuedAt: NOW, contextDigest: "a".repeat(64),
  documents: [{ slug: "distance-sales", documentVersionId: "test-version", renderedSha256: "b".repeat(64) }],
};
const issued = (value = payload) => signLegalPreviewToken(value, TEST_LEGAL_PREVIEW_SECRET);
const verify = (token: string, now = NOW) => verifyLegalPreviewToken(token, TEST_LEGAL_PREVIEW_SECRET, now);

/** Change unused final-character bits while retaining exactly the same decoded bytes. */
function equivalentEncoding(segment: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  assert.ok(segment.length % 4 === 2 || segment.length % 4 === 3, "segment must have padding bits");
  const index = alphabet.indexOf(segment.at(-1)!);
  const alternate = segment.slice(0, -1) + alphabet[index ^ 1];
  assert.notEqual(alternate, segment, "encoding mutation must change text");
  assert.deepEqual(Buffer.from(alternate, "base64url"), Buffer.from(segment, "base64url"), "only unused bits change");
  return alternate;
}
function mutateBytes(segment: string): string {
  const original = Buffer.from(segment, "base64url");
  const mutated = Buffer.from(original);
  assert.ok(mutated.length > 0);
  mutated[0] ^= 1;
  assert.notDeepEqual(mutated, original, "tamper must not be a no-op");
  return mutated.toString("base64url");
}

test("issued token verifies and both segments round-trip canonically", () => {
  const token = issued();
  assert.equal(verify(token).ok, true);
  for (const segment of token.split(".")) assert.equal(Buffer.from(segment, "base64url").toString("base64url"), segment);
});
test("byte-equivalent signature final-character padding bits are rejected", () => {
  const [encoded, signature] = issued().split(".");
  assert.equal(Buffer.from(signature, "base64url").length, 32);
  assert.equal(signature.length % 4, 3);
  assert.equal(verify(`${encoded}.${equivalentEncoding(signature)}`).ok, false);
});
test("byte-equivalent payload final-character padding bits are rejected", () => {
  // Vary only deterministic fixture text until the JSON has unused base64url bits.
  const token = [0, 1, 2].map((n) => issued({ ...payload, orderNumber: payload.orderNumber + "x".repeat(n) }))
    .find((candidate) => candidate.split(".")[0].length % 4 !== 0)!;
  assert.ok(token);
  const [encoded, signature] = token.split(".");
  assert.equal(verify(token).ok, true);
  assert.equal(verify(`${equivalentEncoding(encoded)}.${signature}`).ok, false);
});
test("actual signature and payload byte mutations are rejected with no-op guards", () => {
  const [encoded, signature] = issued().split(".");
  assert.equal(verify(`${encoded}.${mutateBytes(signature)}`).ok, false);
  assert.equal(verify(`${mutateBytes(encoded)}.${signature}`).ok, false);
});
test("malformed signature representations are rejected", () => {
  const [encoded, signature] = issued().split(".");
  for (const malformed of ["!", "AA", signature + "=", signature + "A", "", signature + ".extra"])
    assert.equal(verify(`${encoded}.${malformed}`).ok, false);
});
test("invalid JSON is not parsed before a canonical signature verifies", () => {
  const bytes = Buffer.from("not JSON");
  const encoded = bytes.toString("base64url");
  const signature = createHmac("sha256", TEST_LEGAL_PREVIEW_SECRET).update(bytes).digest("base64url");
  assert.deepEqual(verify(`${encoded}.${mutateBytes(signature)}`), { ok: false, reason: "bad_signature" });
  assert.deepEqual(verify(`${encoded}.${signature}`), { ok: false, reason: "malformed" });
});
test("expiration and clock-skew boundaries remain unchanged", () => {
  const token = issued();
  assert.equal(verify(token, payload.expiresAt - 1).ok, true);
  assert.deepEqual(verify(token, payload.expiresAt), { ok: false, reason: "expired" });
  assert.equal(verify(token, NOW - LEGAL_PREVIEW_CLOCK_SKEW_MS).ok, true);
  assert.deepEqual(verify(token, NOW - LEGAL_PREVIEW_CLOCK_SKEW_MS - 1), { ok: false, reason: "not_yet_valid" });
});
test("old AA suffix tamper can be a no-op; byte mutation cannot", () => {
  // Fixed time, payload, and public synthetic secret: bounded deterministic search, no randomness.
  let found: string | undefined;
  for (let i = 0; i < 4096; i++) {
    const token = issued({ ...payload, orderNumber: `ETS-NOOP-${i}` });
    if (token.endsWith("AA")) { found = token; break; }
  }
  assert.ok(found, "deterministic fixture must demonstrate the old helper's no-op");
  const [encoded, signature] = found.split(".");
  assert.equal(signature.slice(0, -2) + "AA", signature);
  assert.equal(verify(found).ok, true);
  const changed = mutateBytes(signature);
  assert.notEqual(changed, signature);
  assert.equal(verify(`${encoded}.${changed}`).ok, false);
});
