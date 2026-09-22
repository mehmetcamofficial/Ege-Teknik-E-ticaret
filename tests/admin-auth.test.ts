import assert from "node:assert/strict";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import test from "node:test";
import { promisify } from "node:util";
import { verifyPassword } from "../lib/password.ts";
import {
  SESSION_ROTATE_AFTER_MS,
  SESSION_TTL_MS,
  canBootstrapAdmin,
  isSessionActive,
  shouldRotateSession,
} from "../lib/security-policy.ts";

const scrypt = promisify(scryptCallback);
async function encodePassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

const BOOTSTRAP_EMAIL = "owner@egeteknik.test";
const BOOTSTRAP_PASSWORD = "correct-horse-battery";

test("password verification accepts the correct password", async () => {
  const encoded = await encodePassword(BOOTSTRAP_PASSWORD);
  assert.equal(await verifyPassword(BOOTSTRAP_PASSWORD, encoded), true);
});

test("password verification rejects a wrong password", async () => {
  const encoded = await encodePassword(BOOTSTRAP_PASSWORD);
  assert.equal(await verifyPassword("wrong-horse-battery", encoded), false);
});

test("password verification rejects malformed or foreign hash formats", async () => {
  assert.equal(await verifyPassword(BOOTSTRAP_PASSWORD, "bcrypt$salt$deadbeef"), false);
  assert.equal(await verifyPassword(BOOTSTRAP_PASSWORD, "scrypt$saltonly"), false);
  assert.equal(await verifyPassword(BOOTSTRAP_PASSWORD, ""), false);
});

test("bootstrap is allowed only when no admin exists", () => {
  assert.equal(
    canBootstrapAdmin({ adminCount: 0, configuredEmail: BOOTSTRAP_EMAIL, configuredPasswordHash: "scrypt$a$b", submittedEmail: BOOTSTRAP_EMAIL }),
    true,
  );
});

test("bootstrap cannot mint another owner once any admin exists", () => {
  for (const adminCount of [1, 2, 50]) {
    assert.equal(
      canBootstrapAdmin({ adminCount, configuredEmail: BOOTSTRAP_EMAIL, configuredPasswordHash: "scrypt$a$b", submittedEmail: BOOTSTRAP_EMAIL }),
      false,
      `adminCount=${adminCount} must not permit bootstrap`,
    );
  }
});

test("bootstrap is refused for an email that is not the configured bootstrap email", () => {
  assert.equal(
    canBootstrapAdmin({ adminCount: 0, configuredEmail: BOOTSTRAP_EMAIL, configuredPasswordHash: "scrypt$a$b", submittedEmail: "attacker@example.test" }),
    false,
  );
});

test("bootstrap is refused when the bootstrap credential is not configured", () => {
  assert.equal(canBootstrapAdmin({ adminCount: 0, configuredEmail: undefined, configuredPasswordHash: "scrypt$a$b", submittedEmail: BOOTSTRAP_EMAIL }), false);
  assert.equal(canBootstrapAdmin({ adminCount: 0, configuredEmail: BOOTSTRAP_EMAIL, configuredPasswordHash: undefined, submittedEmail: BOOTSTRAP_EMAIL }), false);
});

test("bootstrap email comparison ignores case and surrounding whitespace", () => {
  assert.equal(
    canBootstrapAdmin({ adminCount: 0, configuredEmail: " Owner@EgeTeknik.test ", configuredPasswordHash: "scrypt$a$b", submittedEmail: BOOTSTRAP_EMAIL }),
    true,
  );
});

test("a wrong bootstrap password still fails even in the initial state", async () => {
  const encoded = await encodePassword(BOOTSTRAP_PASSWORD);
  const eligible = canBootstrapAdmin({ adminCount: 0, configuredEmail: BOOTSTRAP_EMAIL, configuredPasswordHash: encoded, submittedEmail: BOOTSTRAP_EMAIL });
  assert.equal(eligible, true);
  assert.equal(await verifyPassword("not-the-password", encoded), false);
});

test("an active session is usable until it expires", () => {
  const now = new Date("2026-09-22T12:00:00Z");
  assert.equal(isSessionActive({ expiresAt: new Date(now.getTime() + 1000), revokedAt: null }, now), true);
});

test("an expired session is rejected", () => {
  const now = new Date("2026-09-22T12:00:00Z");
  assert.equal(isSessionActive({ expiresAt: new Date(now.getTime() - 1), revokedAt: null }, now), false);
  assert.equal(isSessionActive({ expiresAt: new Date(now.getTime() - SESSION_TTL_MS), revokedAt: null }, now), false);
});

test("a revoked session is rejected even before its expiry", () => {
  const now = new Date("2026-09-22T12:00:00Z");
  assert.equal(isSessionActive({ expiresAt: new Date(now.getTime() + SESSION_TTL_MS), revokedAt: now }, now), false);
});

test("sessions rotate only after the rotation interval elapses", () => {
  const now = new Date("2026-09-22T12:00:00Z");
  assert.equal(shouldRotateSession(new Date(now.getTime() - SESSION_ROTATE_AFTER_MS - 1), now), true);
  assert.equal(shouldRotateSession(new Date(now.getTime() - SESSION_ROTATE_AFTER_MS + 1000), now), false);
  assert.equal(shouldRotateSession(now, now), false);
});
