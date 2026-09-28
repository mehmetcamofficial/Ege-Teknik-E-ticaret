/**
 * Admin session rotation (hotfix): the database token and the browser cookie must never disagree, and
 * rotation must never log an admin out - not during a page render, not under parallel requests, not when
 * a cookie write or the database fails half-way.
 *
 * The real rotateSessionIfDue() runs against an in-memory admin_sessions table that implements the same
 * rules as the SQL in lib/admin-auth.ts (compare-and-set on the old row, superseded expiry, revoked/expiry
 * checks), and a simulated browser that only ever holds the cookies it was actually sent.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SESSION_ROTATION_GRACE_MS, isSupersededSession, rotateSessionIfDue, supersededExpiry, type NewSessionRow, type RotationDeps, type RotationOutcome } from "../lib/admin-session-rotation.ts";
import { SESSION_ROTATE_AFTER_MS, SESSION_TTL_MS, isSessionActive } from "../lib/security-policy.ts";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const MIN = 60_000;
const T0 = new Date("2026-09-28T09:00:00.000Z");

type Row = NewSessionRow & { revokedAt: Date | null };
class Fixture {
  now = new Date(T0);
  rows: Row[] = [];
  /** What the browser holds - changed only by a Set-Cookie it received. */
  browserCookie: string | null = null;
  sessionCookieWrites: string[] = [];
  probes = 0;
  logs: string[] = [];
  writable = true;
  failCookieSet = false;
  failClaim = false;
  failRevert = false;
  private counter = 0;

  constructor() { this.login("admin-1", "token-initial"); }

  login(adminUserId: string, token: string) {
    this.rows.push({ id: `s${++this.counter}`, adminUserId, tokenHash: sha(token), expiresAt: new Date(this.now.getTime() + SESSION_TTL_MS), lastRotatedAt: new Date(this.now), revokedAt: null, ipHash: "ip", userAgentHash: "ua" });
    if (adminUserId === "admin-1") this.browserCookie = token;
  }
  advance(ms: number) { this.now = new Date(this.now.getTime() + ms); }
  snapshot() { return JSON.stringify(this.rows); }
  /** The same predicate getAdminUser() puts in its SQL. */
  find(token: string | null) { return token ? this.rows.find((r) => r.tokenHash === sha(token) && isSessionActive({ expiresAt: r.expiresAt, revokedAt: r.revokedAt }, this.now)) : undefined; }
  authenticates(token: string | null) { return Boolean(this.find(token)); }

  deps(onSessionCookie: (token: string) => void = () => {}): RotationDeps {
    let ids = 0;
    return {
      now: () => this.now,
      newToken: () => `token-${++ids}-${Math.random().toString(36).slice(2)}`,
      newId: () => `n${++this.counter}`,
      hash: sha,
      probeCookieWritable: () => { this.probes++; if (!this.writable) throw new Error("Cookies can only be modified in a Server Action or Route Handler"); },
      setSessionCookie: (token) => { if (this.failCookieSet) throw new Error("cookie write failed"); this.sessionCookieWrites.push(token); onSessionCookie(token); },
      claim: async ({ oldId, dueBefore, now, graceUntil, next }) => {
        await Promise.resolve(); // let concurrent requests interleave before the atomic step
        if (this.failClaim) throw new Error("db down");
        const old = this.rows.find((r) => r.id === oldId);
        if (!old || old.revokedAt || !(old.lastRotatedAt.getTime() < dueBefore.getTime())) return false; // compare-and-set
        old.lastRotatedAt = now;
        old.expiresAt = supersededExpiry(old.expiresAt, now, graceUntil.getTime() - now.getTime());
        this.rows.push({ ...next, revokedAt: null });
        return true;
      },
      revertClaim: async ({ oldId, newId, previous }) => {
        if (this.failRevert) throw new Error("db down");
        this.rows = this.rows.filter((r) => r.id !== newId);
        const old = this.rows.find((r) => r.id === oldId)!;
        old.lastRotatedAt = previous.lastRotatedAt;
        old.expiresAt = previous.expiresAt;
      },
      log: (outcome) => { this.logs.push(outcome); },
    };
  }

  /**
   * One admin request as getAdminUser() sees it: authenticate the cookie the browser sent, then let
   * rotation ride along. Returns what the response would carry. The browser only learns about a new
   * cookie when it is delivered (deliver()).
   */
  async request(sentCookie: string | null) {
    const row = this.find(sentCookie);
    if (!row) return { status: 403, outcome: null as RotationOutcome | null, setCookie: null as string | null };
    let setCookie: string | null = null; // THIS request's own Set-Cookie, not a shared counter
    const outcome = await rotateSessionIfDue(row, this.deps((token) => { setCookie = token; }));
    return { status: 200, outcome, setCookie };
  }
  deliver(response: { setCookie: string | null }) { if (response.setCookie) this.browserCookie = response.setCookie; }
}

// ---- fresh session: nothing happens -----------------------------------------------------------
test("a fresh session (< 30 minutes) is not rotated and the same cookie keeps working", async () => {
  const f = new Fixture();
  f.advance(SESSION_ROTATE_AFTER_MS - 1000);
  const before = f.snapshot();
  const res = await f.request(f.browserCookie);
  assert.deepEqual([res.status, res.outcome, res.setCookie], [200, "not_due", null]);
  assert.equal(f.snapshot(), before, "no database write");
  assert.equal(f.probes, 0, "not even a cookie probe");
  assert.equal(f.authenticates("token-initial"), true);
});

test("the rotation threshold is strictly more than 30 minutes", async () => {
  const f = new Fixture();
  f.advance(SESSION_ROTATE_AFTER_MS);
  assert.equal((await f.request(f.browserCookie)).outcome, "not_due");
  f.advance(1);
  assert.equal((await f.request(f.browserCookie)).outcome, "rotated");
});

// ---- rotation due: the reported bug -------------------------------------------------------------
test("a due session rotates: the request succeeds, a new cookie is issued, the database moves to it, and the next request is 200", async () => {
  const f = new Fixture();
  f.advance(SESSION_ROTATE_AFTER_MS + 5 * MIN);
  const res = await f.request(f.browserCookie);
  assert.deepEqual([res.status, res.outcome], [200, "rotated"]);
  assert.ok(res.setCookie && res.setCookie !== "token-initial", "a new cookie value was issued");
  assert.equal(f.sessionCookieWrites.length, 1);
  assert.ok(f.rows.some((r) => r.tokenHash === sha(res.setCookie!)), "the database holds the token the browser was sent");
  f.deliver(res);
  const next = await f.request(f.browserCookie);
  assert.deepEqual([next.status, next.outcome], [200, "not_due"], "the very next request is 200 and does not rotate again");
  assert.equal(f.rows.length, 2);
});

test("the bug scenario, replayed: a page render (cookie not writable) never moves the database", async () => {
  const f = new Fixture();
  f.writable = false; // Server Component render: Next refuses cookie writes
  f.advance(SESSION_ROTATE_AFTER_MS + MIN);
  const before = f.snapshot();
  for (let i = 0; i < 5; i++) {
    const res = await f.request(f.browserCookie);
    assert.deepEqual([res.status, res.outcome, res.setCookie], [200, "skipped_cookie_unwritable", null]);
  }
  assert.equal(f.snapshot(), before, "DB token unchanged: DB and browser cookie still agree");
  assert.deepEqual(f.sessionCookieWrites, []);
  // ...and the session keeps working; the next writable request (an API call) then rotates it properly.
  f.writable = true;
  const api = await f.request(f.browserCookie);
  assert.equal(api.outcome, "rotated");
  f.deliver(api);
  assert.equal((await f.request(f.browserCookie)).status, 200);
});

test("rotation never extends the session: the new row inherits the absolute expiry", async () => {
  const f = new Fixture();
  const original = f.rows[0].expiresAt;
  f.advance(SESSION_ROTATE_AFTER_MS + MIN);
  await f.request(f.browserCookie);
  const fresh = f.rows[1];
  assert.equal(fresh.expiresAt.getTime(), original.getTime());
  assert.ok(f.rows[0].expiresAt.getTime() <= original.getTime(), "the old row never gets a later expiry");
});

// ---- grace window --------------------------------------------------------------------------------
test("the superseded token keeps working for the grace window, then stops", async () => {
  const f = new Fixture();
  f.advance(SESSION_ROTATE_AFTER_MS + MIN);
  await f.request(f.browserCookie);
  f.advance(SESSION_ROTATION_GRACE_MS - 1000);
  assert.equal(f.authenticates("token-initial"), true, "still valid inside the grace window");
  f.advance(2000);
  assert.equal(f.authenticates("token-initial"), false, "dead once the grace window passed");
});

test("a superseded row is recognisable by its shortened expiry, a normal row is not", () => {
  const now = new Date(T0);
  assert.equal(isSupersededSession({ lastRotatedAt: now, expiresAt: new Date(now.getTime() + SESSION_ROTATION_GRACE_MS) }), true);
  assert.equal(isSupersededSession({ lastRotatedAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) }), false);
  assert.equal(supersededExpiry(new Date(now.getTime() + 30_000), now).getTime(), now.getTime() + 30_000, "never lengthens a nearer expiry");
});

// ---- failure safety ------------------------------------------------------------------------------
test("a database failure during the claim changes nothing and issues no session cookie", async () => {
  const f = new Fixture();
  f.failClaim = true;
  f.advance(SESSION_ROTATE_AFTER_MS + MIN);
  const before = f.snapshot();
  const res = await f.request(f.browserCookie);
  assert.deepEqual([res.status, res.outcome, res.setCookie], [200, "failed", null], "the admin is still authenticated");
  assert.equal(f.snapshot(), before);
  assert.deepEqual(f.sessionCookieWrites, []);
});

test("a cookie write that fails AFTER the claim rolls the database back: never DB = new token with browser = old token", async () => {
  const f = new Fixture();
  f.failCookieSet = true;
  f.advance(SESSION_ROTATE_AFTER_MS + MIN);
  const before = f.snapshot();
  const res = await f.request(f.browserCookie);
  assert.deepEqual([res.status, res.outcome, res.setCookie], [200, "failed", null]);
  assert.equal(f.snapshot(), before, "rows restored exactly");
  assert.equal(f.authenticates("token-initial"), true);
});

test("even if the rollback itself fails, the old token stays valid for the grace window and the failure is logged", async () => {
  const f = new Fixture();
  f.failCookieSet = true;
  f.failRevert = true;
  f.advance(SESSION_ROTATE_AFTER_MS + MIN);
  const res = await f.request(f.browserCookie);
  assert.equal(res.outcome, "failed");
  assert.deepEqual(f.logs, ["revert_failed", "failed"]);
  assert.equal(f.authenticates("token-initial"), true, "not logged out mid-request");
});

// ---- concurrency ---------------------------------------------------------------------------------
test("parallel requests at the rotation moment: exactly one rotates, none is rejected, only the winner writes a cookie", async () => {
  const f = new Fixture();
  f.advance(SESSION_ROTATE_AFTER_MS + MIN);
  const sent = f.browserCookie;
  // Everyone authenticates against the same stale row, then all rotate at once.
  const responses = await Promise.all(Array.from({ length: 8 }, () => f.request(sent)));
  assert.ok(responses.every((r) => r.status === 200), "no request was turned into a 403");
  assert.equal(responses.filter((r) => r.outcome === "rotated").length, 1);
  assert.equal(responses.filter((r) => r.outcome === "skipped_lost_race").length, 7);
  assert.equal(f.sessionCookieWrites.length, 1, "losers never touch the session cookie");
  assert.equal(responses.filter((r) => r.setCookie).length, 1);
  assert.equal(f.rows.length, 2, "one successor row, no orphans");
  // The browser can receive the responses in ANY order and ends up with the winner's cookie or the still-valid old one.
  for (const order of [responses, [...responses].reverse()]) {
    const b = new Fixture();
    b.rows = f.rows.map((r) => ({ ...r }));
    b.now = new Date(f.now);
    b.browserCookie = sent;
    for (const r of order) b.deliver(r);
    assert.equal(b.authenticates(b.browserCookie), true, "whatever the arrival order, the browser's cookie authenticates");
    assert.equal(b.browserCookie, f.sessionCookieWrites[0], "the winner's cookie is what the browser ends up with");
  }
  // Requests already in flight with the old token during the grace window still succeed.
  assert.equal((await f.request(sent)).status, 200);
});

// ---- expiry / revocation -----------------------------------------------------------------------
test("an expired session is rejected and never rotated", async () => {
  const f = new Fixture();
  f.advance(SESSION_TTL_MS + 1);
  const res = await f.request(f.browserCookie);
  assert.deepEqual([res.status, res.outcome], [403, null]);
  assert.equal(f.probes, 0);
  assert.equal(f.rows.length, 1);
});

test("a revoked session is never rotated back to life", async () => {
  const f = new Fixture();
  f.advance(SESSION_ROTATE_AFTER_MS + MIN);
  const stale = f.find(f.browserCookie)!;
  f.rows[0].revokedAt = new Date(f.now); // revoked between authentication and the claim
  const outcome = await rotateSessionIfDue(stale, f.deps());
  assert.equal(outcome, "skipped_lost_race");
  assert.equal(f.rows.length, 1, "no successor was created");
  assert.equal(f.authenticates("token-initial"), false);
});

// ---- logout --------------------------------------------------------------------------------------
/** Mirrors revokeAdminSession(): the presented row, plus the same admin's superseded rows. */
function logout(f: Fixture, token: string) {
  const current = f.rows.find((r) => r.tokenHash === sha(token));
  for (const r of f.rows) if (r.tokenHash === sha(token)) r.revokedAt = new Date(f.now);
  if (current) for (const r of f.rows) if (r.adminUserId === current.adminUserId && !r.revokedAt && r.expiresAt > f.now && isSupersededSession(r)) r.revokedAt = new Date(f.now);
}

test("logout after a rotation invalidates the new token AND the just-superseded one; other admins and devices are untouched", async () => {
  const f = new Fixture();
  f.login("admin-2", "token-other-admin");
  f.login("admin-1", "token-second-device");
  f.browserCookie = "token-initial";
  f.advance(SESSION_ROTATE_AFTER_MS + MIN);
  const res = await f.request(f.browserCookie);
  f.deliver(res);
  assert.equal(res.outcome, "rotated");
  logout(f, f.browserCookie!);
  assert.equal(f.authenticates(f.browserCookie), false, "new token rejected");
  assert.equal(f.authenticates("token-initial"), false, "superseded token rejected too");
  assert.equal(f.authenticates("token-other-admin"), true);
  assert.equal(f.authenticates("token-second-device"), true, "another device of the same admin stays signed in");
});

// ---- observability and secrecy -----------------------------------------------------------------
test("only outcome names are logged - never a token, a hash or a cookie value", async () => {
  const f = new Fixture();
  f.advance(SESSION_ROTATE_AFTER_MS + MIN);
  const res = await f.request(f.browserCookie);
  assert.deepEqual(f.logs, ["rotated"]);
  for (const line of f.logs) assert.equal(line.includes(res.setCookie!) || line.includes("token-initial") || /[0-9a-f]{64}/.test(line), false);
});

// ---- wiring in lib/admin-auth.ts -----------------------------------------------------------------
const auth = readFileSync("lib/admin-auth.ts", "utf8");
const rotation = readFileSync("lib/admin-session-rotation.ts", "utf8");
const getAdminUserSource = auth.slice(auth.indexOf("export async function getAdminUser"), auth.indexOf("/**\n * Effective permission"));

test("the old pattern is gone: no database rotation followed by a swallowed cookie write", () => {
  assert.doesNotMatch(auth, /try\{jar\.set\(COOKIE,next/);
  assert.doesNotMatch(getAdminUserSource, /set\(\{tokenHash/, "getAdminUser no longer rewrites the token hash itself");
  assert.doesNotMatch(getAdminUserSource, /jar\.set\(/, "getAdminUser never writes cookies directly");
  assert.match(getAdminUserSource, /rotateSessionIfDue\(row\.session,rotationDeps\(jar,db\)\)/);
});

test("rotation only ever follows a successful authorization check, and can never fail the request it rides on", () => {
  assert.ok(getAdminUserSource.indexOf("hasEffectivePermission(") < getAdminUserSource.indexOf("rotateSessionIfDue("), "an unauthorized user never triggers rotation");
  assert.match(getAdminUserSource, /try\{await rotateSessionIfDue\([^)]*\)[^)]*\)\}catch\{\}/);
  assert.match(getAdminUserSource, /if\(!row\)return null/);
});

test("the protocol order is fixed: probe, then the atomic claim, then the cookie - and no cookie is written by a loser", () => {
  const body = rotation.slice(rotation.indexOf("export async function rotateSessionIfDue"));
  assert.ok(body.indexOf("deps.probeCookieWritable()") < body.indexOf("deps.claim("));
  assert.ok(body.indexOf("deps.claim(") < body.indexOf("deps.setSessionCookie("));
  const loser = body.slice(body.indexOf("if (!claimed)"), body.indexOf('return "skipped_lost_race"'));
  assert.ok(loser.length > 0 && !/setSessionCookie/.test(loser), "the losing branch writes no session cookie");
});

test("the cookie probe deletes a throwaway cookie, never the session cookie", () => {
  assert.match(auth, /const PROBE_COOKIE = "ege_admin_cookie_probe"/);
  assert.match(auth, /probeCookieWritable: \(\) => \{ jar\.delete\(\{ name: PROBE_COOKIE, path: "\/" \}\); \}/);
});

test("session cookie hardening and fixation protection are unchanged", () => {
  assert.match(auth, /const cookieOptions=\(extra:Record<string,unknown>\)=>\(\{httpOnly:true,secure:process\.env\.NODE_ENV==="production",sameSite:"strict" as const,path:"\/",\.\.\.extra\}\)/);
  assert.match(auth, /export async function createAdminSession[\s\S]*?const token=randomBytes\(32\)\.toString\("base64url"\)/, "login mints a fresh random token; the client never supplies one");
  assert.match(auth, /export const sessionCookieName=COOKIE/);
  assert.match(readFileSync("app/api/auth/login/route.ts", "utf8"), /createAdminSession\(admin\.id, request\)/);
});

test("rotation logging carries outcome names only", () => {
  const logger = auth.slice(auth.indexOf("function rotationOutcomeLog"), auth.indexOf("function rotationDeps"));
  assert.match(logger, /console\.(warn|info)\("admin_session_rotation", \{ outcome \}\)/);
  const code = logger.replace(/\/\/.*$/gm, ""); // comments may say what is NOT logged
  assert.doesNotMatch(code, /token|hash|secret|jar\./i); // outcome names such as skipped_cookie_unwritable are fine
  assert.doesNotMatch(rotation, /console\./, "the framework-free module logs only through the injected callback");
});

test("logout revokes the presented session and the admin's just-superseded sessions", () => {
  const revoke = auth.slice(auth.indexOf("export async function revokeAdminSession"), auth.indexOf("// Rotation lives in"));
  assert.match(revoke, /eq\(adminSessions\.tokenHash,tokenHash\)/);
  assert.match(revoke, /lte\(adminSessions\.expiresAt,sql`\$\{adminSessions\.lastRotatedAt\} \+ \(\$\{sql\.raw\(String\(SESSION_ROTATION_GRACE_MS\)\)\} \* interval '1 millisecond'\)`\)/);
  assert.match(revoke, /jar\.set\(COOKIE,"",cookieOptions\(\{maxAge:0\}\)\)/);
});

test("the claim is one transaction that re-checks 'still due' and 'not revoked' in SQL and never lengthens the expiry", () => {
  const claim = auth.slice(auth.indexOf("claim: ({ oldId"), auth.indexOf("revertClaim:"));
  assert.match(claim, /db\.transaction/);
  assert.match(claim, /least\(\$\{adminSessions\.expiresAt\}, \$\{graceUntil\.toISOString\(\)\}::timestamptz\)/);
  assert.match(claim, /isNull\(adminSessions\.revokedAt\), lt\(adminSessions\.lastRotatedAt, dueBefore\)/);
  assert.ok(claim.indexOf("returning") < claim.indexOf("tx.insert(adminSessions)"), "the successor row is inserted only after the claim succeeded");
});

test("no schema or migration change: rotation uses the existing admin_sessions columns", () => {
  const schema = readFileSync("db/schema.ts", "utf8");
  const sessions = schema.slice(schema.indexOf("export const adminSessions"), schema.indexOf("export const adminSessions") + 700);
  for (const column of ["tokenHash", "expiresAt", "lastRotatedAt", "revokedAt", "ipHash", "userAgentHash"]) assert.match(sessions, new RegExp(column));
});
