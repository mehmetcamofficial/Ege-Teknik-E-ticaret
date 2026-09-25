import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authLib = readFileSync("lib/admin-auth.ts", "utf8");
const mail = readFileSync("lib/mail.ts", "utf8");
const forgotRoute = readFileSync("app/api/auth/forgot-password/route.ts", "utf8");
const resetRoute = readFileSync("app/api/auth/reset-password/route.ts", "utf8");
const schema = readFileSync("db/schema.ts", "utf8");
const migration = readFileSync("drizzle-pg/0010_admin_password_resets.sql", "utf8");
const loginPage = readFileSync("app/admin/login/page.tsx", "utf8");
const forgotPage = readFileSync("app/admin/forgot-password/page.tsx", "utf8");
const resetPage = readFileSync("app/admin/reset-password/page.tsx", "utf8");
const adminClient = readFileSync("app/admin/admin-client.tsx", "utf8");

// ---- schema / migration ---------------------------------------------------------------------
test("the reset-token table stores only a hash, never the raw token; single-use via used_at", () => {
  assert.match(schema, /tokenHash:text\("token_hash"\)\.notNull\(\)/);
  assert.doesNotMatch(schema, /rawToken|plainToken|\btoken:text/i);
  assert.match(schema, /usedAt:timestamp\("used_at"/);
  assert.match(migration, /CONSTRAINT "admin_password_resets_token_ck" CHECK \("admin_password_resets"\."token_hash" ~ '\^\[0-9a-f\]\{64\}\$'\)/);
});
test("the reset-token table has a real FK to admin_users and a unique index on the token hash", () => {
  assert.match(migration, /FOREIGN KEY \("admin_user_id"\) REFERENCES "public"\."admin_users"\("id"\)/);
  assert.match(migration, /CREATE UNIQUE INDEX "admin_password_resets_token_uq" ON "admin_password_resets" USING btree \("token_hash"\)/);
});

// ---- lib/admin-auth.ts: request side --------------------------------------------------------
test("requestPasswordReset never returns the raw token to its caller - only a status", () => {
  const fn = authLib.slice(authLib.indexOf("export async function requestPasswordReset"), authLib.indexOf("export type ResetConsumeOutcome"));
  assert.doesNotMatch(fn, /return\s*\{[^}]*token/i, "the function's return type must never carry the raw token");
  assert.match(fn, /const token = randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(fn, /tokenHash: sha256\(token\)/);
});
test("a new request supersedes any still-outstanding token for the same admin before inserting the new one", () => {
  const fn = authLib.slice(authLib.indexOf("export async function requestPasswordReset"), authLib.indexOf("const resetUrl"));
  assert.match(fn, /update\(adminPasswordResets\)\.set\(\{\s*usedAt:\s*now\s*\}\)\.where\(and\(eq\(adminPasswordResets\.adminUserId, admin\.id\), isNull\(adminPasswordResets\.usedAt\)\)\)/);
});
test("mail delivery failure/non-configuration never changes what the function returns in a way the route could leak - it is a distinct, internal-only status", () => {
  assert.match(authLib, /status: "email_not_configured"/);
  assert.match(authLib, /status: "send_failed"/);
});

// ---- lib/admin-auth.ts: consume side --------------------------------------------------------
test("consuming a token is a conditional UPDATE gated on used_at IS NULL, exactly like reviews-db.ts's optimistic-concurrency moderation update", () => {
  const fn = authLib.slice(authLib.indexOf("export async function consumePasswordResetToken"));
  assert.match(fn, /tx\.update\(adminPasswordResets\)\.set\(\{\s*usedAt:\s*now\s*\}\)\.where\(and\(eq\(adminPasswordResets\.id, row\.id\), isNull\(adminPasswordResets\.usedAt\)\)\)\.returning/);
  assert.match(fn, /if \(!consumed\.length\) return \{ ok: false \}/);
});
test("the reset transaction updates the password hash, revokes ALL of that admin's sessions, and writes an audit log", () => {
  const fn = authLib.slice(authLib.indexOf("export async function consumePasswordResetToken"));
  assert.match(fn, /tx\.update\(adminUsers\)\.set\(\{\s*passwordHash:\s*newPasswordHash/);
  assert.match(fn, /tx\.update\(adminSessions\)\.set\(\{\s*revokedAt:\s*now\s*\}\)\.where\(and\(eq\(adminSessions\.adminUserId, row\.adminUserId\), isNull\(adminSessions\.revokedAt\)\)\)/, "must revoke every live session for the user, not a single one");
  assert.match(fn, /tx\.insert\(auditLogs\)\.values/);
  assert.match(fn, /action: "password_reset"/);
});
test("the audit log payload for a password reset never carries the token, its hash, or the new password/hash", () => {
  const fn = authLib.slice(authLib.indexOf("export async function consumePasswordResetToken"));
  const payloadMatch = fn.match(/payload:\s*\{[^}]*\}/);
  assert.ok(payloadMatch, "expected a payload literal in the audit insert");
  // "forgot_password" as a bare method-name VALUE is fine; a real leak would look like a field
  // (tokenHash:, newPasswordHash:, rawToken:) or an actual hex/base64 secret embedded in the payload.
  assert.doesNotMatch(payloadMatch![0], /tokenHash|rawToken|newPasswordHash|passwordHash\s*:|[0-9a-f]{32,}/i);
  assert.deepEqual(payloadMatch![0], 'payload: { method: "forgot_password" }');
});
test("token lookup requires: unused, unexpired, and the joined admin is active - all three, not a subset", () => {
  const fn = authLib.slice(authLib.indexOf("export async function consumePasswordResetToken"), authLib.indexOf("return db.transaction"));
  assert.match(fn, /isNull\(adminPasswordResets\.usedAt\)/);
  assert.match(fn, /gt\(adminPasswordResets\.expiresAt, now\)/);
  assert.match(fn, /eq\(adminUsers\.active, true\)/);
});

// ---- lib/mail.ts ------------------------------------------------------------------------------
test("sendMail reports not_configured rather than silently pretending to succeed when no provider is set up", () => {
  assert.match(mail, /if \(!apiKey \|\| !from\) return \{ ok: false, reason: "not_configured" \};/);
});
test("sendMail never throws past its own try/catch - a network failure becomes send_failed, not an unhandled rejection", () => {
  assert.match(mail, /catch \{\s*return \{ ok: false, reason: "send_failed" \};\s*\}/);
});

// ---- routes: enumeration safety ---------------------------------------------------------------
test("forgot-password redirects to the exact same location on every path: unknown e-mail, inactive admin, mail not configured, send failure, or a genuine send", () => {
  const successBranches = (forgotRoute.match(/return sent\(\);/g) ?? []).length;
  assert.ok(successBranches >= 3, `expected at least 3 call sites returning the identical sent() redirect, found ${successBranches}`);
  assert.doesNotMatch(forgotRoute, /outcome\.status\s*===?\s*["'](sent|no_such_admin)["'][\s\S]*?redirect/, "the response must never branch on whether the admin was found");
});
test("forgot-password rate-limits and enforces same-origin before doing anything else", () => {
  const rl = forgotRoute.indexOf('rateLimit(request, "admin-forgot-password"');
  const req = forgotRoute.indexOf("requestPasswordReset(parsed.data.email");
  assert.ok(rl > 0 && rl < req);
  assert.match(forgotRoute, /assertSameOrigin\(request\)/);
});
test("forgot-password never echoes the submitted e-mail, or any account-existence detail, back in the response", () => {
  assert.doesNotMatch(forgotRoute, /Response\.json|body:.*email/i);
});

// ---- routes: reset-password -------------------------------------------------------------------
test("reset-password checks password confirmation match and the password policy before ever touching the token", () => {
  const mismatchIdx = resetRoute.indexOf("password !== parsed.data.confirmPassword");
  const policyIdx = resetRoute.indexOf("validatePasswordPolicy(");
  const consumeIdx = resetRoute.indexOf("consumePasswordResetToken(");
  assert.ok(mismatchIdx > 0 && policyIdx > mismatchIdx && consumeIdx > policyIdx);
});
test("reset-password hashes the new password with hashPassword before ever calling consumePasswordResetToken - the plaintext password is never passed to the DB layer", () => {
  const hashIdx = resetRoute.indexOf("hashPassword(parsed.data.password)");
  const consumeIdx = resetRoute.indexOf("consumePasswordResetToken(parsed.data.token, passwordHash)");
  assert.ok(hashIdx > 0 && consumeIdx > hashIdx);
});
test("reset-password rate-limits and enforces same-origin", () => {
  assert.match(resetRoute, /assertSameOrigin\(request\)/);
  assert.match(resetRoute, /rateLimit\(request, "admin-reset-password"/);
});
test("a failed consume (invalid/expired/replayed token) and a malformed request both redirect with a generic error - never a distinguishing message", () => {
  assert.match(resetRoute, /error=invalid/);
});

// ---- UI pages: professional, responsive, accessible touches -----------------------------------
test("all three auth pages use the 44px touch-target convention (h-11) for their inputs and primary button", () => {
  for (const page of [loginPage, forgotPage, resetPage]) {
    assert.match(page, /h-11/);
  }
});
test("error/status messages use an ARIA role so they are announced, not just visually styled", () => {
  assert.match(loginPage, /role="alert"/);
  assert.match(loginPage, /role="status"/);
  assert.match(forgotPage, /role="status"/);
  assert.match(forgotPage, /role="alert"/);
  assert.match(resetPage, /role="alert"/);
});
test("login links to forgot-password; forgot-password and reset-password both link back to login", () => {
  assert.match(loginPage, /href="\/admin\/forgot-password"/);
  assert.match(forgotPage, /href="\/admin\/login"/);
  assert.match(resetPage, /href="\/admin\/login"/);
});
test("the reset-password page never validates the token by reading the database at render time - only the POST does, so an invalid token in the URL reveals nothing extra by itself", () => {
  assert.doesNotMatch(resetPage, /getDb|adminPasswordResets|drizzle/i);
});
test("the password field on reset-password states the policy in plain language and requires confirmation", () => {
  assert.match(resetPage, /name="confirmPassword"/);
  assert.match(resetPage, /Büyük\/küçük harf veya sembol zorunluluğu yok/);
});

// ---- admin dashboard layout fix -----------------------------------------------------------------
test("the admin dashboard's outer grid constrains its single column to minmax(0,1fr), so content (e.g. wide tables) can never force the whole page wider than the viewport", () => {
  assert.match(adminClient, /className="mx-auto grid max-w-7xl grid-cols-\[minmax\(0,1fr\)\] gap-6 px-5 py-7"/);
});
