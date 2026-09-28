import assert from "node:assert/strict";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { promisify } from "node:util";
import { verifyPassword } from "../lib/password.ts";
import {
  SESSION_ROTATE_AFTER_MS,
  SESSION_TTL_MS,
  isSessionActive,
  shouldRotateSession,
} from "../lib/security-policy.ts";

const scrypt = promisify(scryptCallback);
async function encodePassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

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

test("login is authentication-only and cannot bootstrap an administrator over HTTP", () => {
  const source = readFileSync("app/api/auth/login/route.ts", "utf8");
  assert.doesNotMatch(source, /bootstrap|ADMIN_BOOTSTRAP|insert\(adminUsers\)|role:\s*["']owner["']/i);
  assert.match(source, /select\(\)\.from\(adminUsers\).*where\(eq\(adminUsers\.email/);
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
