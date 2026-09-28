/**
 * Admin session token rotation, split out of lib/admin-auth.ts so the whole protocol can be tested
 * without Next.js or Postgres (every side effect is an injected dependency).
 *
 * The bug this replaces: getAdminUser() wrote the new token hash to the database FIRST and only then
 * tried `cookies().set(...)` inside `try { } catch { }`. During a Server Component render Next refuses
 * cookie writes, so the database moved to the new token while the browser kept the old one - every later
 * request was rejected (403 from the admin APIs, a redirect to /admin/login on reload), about 30 minutes
 * after each login. Even in a Route Handler (where the write works) the instant one request rotated, its
 * parallel requests still carrying the old token were rejected.
 *
 * Invariants:
 *  1. The database is never rotated unless the response can actually carry the new cookie.
 *  2. Rotation never invalidates the token the browser holds: the old row stays valid for a short grace
 *     window, so parallel requests, a slow response or a lost Set-Cookie do not log the admin out.
 *  3. Exactly one of several concurrent requests rotates (compare-and-set on the old row) and only that
 *     request writes a cookie, so a late loser can never overwrite the winner's cookie with the old token.
 *  4. Rotation never extends the session: the new row inherits the old row's absolute expiry.
 *  5. Rotation problems never fail authentication - the caller is authenticated either way.
 *
 * Nothing here ever logs a token, a token hash or a cookie value.
 */
import { SESSION_ROTATE_AFTER_MS, shouldRotateSession } from "./security-policy.ts";

/** How long a superseded token keeps working after its replacement was issued. */
export const SESSION_ROTATION_GRACE_MS = 2 * 60 * 1000;

export type RotatableSession = { id: string; adminUserId: string; expiresAt: Date; lastRotatedAt: Date; ipHash: string; userAgentHash: string };
export type NewSessionRow = { id: string; adminUserId: string; tokenHash: string; expiresAt: Date; lastRotatedAt: Date; ipHash: string; userAgentHash: string };

export type RotationOutcome = "not_due" | "rotated" | "skipped_cookie_unwritable" | "skipped_lost_race" | "failed";

export type RotationDeps = {
  now: () => Date;
  newToken: () => string;
  newId: () => string;
  hash: (token: string) => string;
  /** Throws where the response cannot carry a cookie (Server Component render). Touches no session cookie. */
  probeCookieWritable: () => void;
  /** Writes the session cookie. */
  setSessionCookie: (token: string, expires: Date) => void;
  /**
   * ONE atomic step: if `oldId` is still due (lastRotatedAt < dueBefore) and not revoked, mark it superseded
   * (lastRotatedAt = now, expiresAt = min(expiresAt, graceUntil)) and insert `next`. Returns false when
   * another request already rotated it. Must throw, not half-apply, on failure.
   */
  claim: (input: { oldId: string; dueBefore: Date; now: Date; graceUntil: Date; next: NewSessionRow }) => Promise<boolean>;
  /** Undoes a successful claim (used only if the cookie write fails after the database moved). */
  revertClaim: (input: { oldId: string; newId: string; previous: { lastRotatedAt: Date; expiresAt: Date } }) => Promise<void>;
  log: (outcome: RotationOutcome | "revert_failed") => void;
};

export function supersededExpiry(expiresAt: Date, now: Date, graceMs = SESSION_ROTATION_GRACE_MS): Date {
  return new Date(Math.min(expiresAt.getTime(), now.getTime() + graceMs));
}

/** A row that has been replaced by a successor: it only lives on for the grace window. */
export function isSupersededSession(row: { lastRotatedAt: Date; expiresAt: Date }, graceMs = SESSION_ROTATION_GRACE_MS): boolean {
  return row.expiresAt.getTime() <= row.lastRotatedAt.getTime() + graceMs;
}

export async function rotateSessionIfDue(session: RotatableSession, deps: RotationDeps): Promise<RotationOutcome> {
  const now = deps.now();
  if (!shouldRotateSession(session.lastRotatedAt, now)) return "not_due";

  // 1. Only proceed where the cookie can be written. Nothing has been changed yet if this throws.
  try {
    deps.probeCookieWritable();
  } catch {
    deps.log("skipped_cookie_unwritable");
    return "skipped_cookie_unwritable";
  }

  // 2. The database claim - atomic, and won by exactly one of any number of concurrent requests.
  const token = deps.newToken();
  const previous = { lastRotatedAt: new Date(session.lastRotatedAt), expiresAt: new Date(session.expiresAt) }; // before the claim moves the row
  const next: NewSessionRow = { id: deps.newId(), adminUserId: session.adminUserId, tokenHash: deps.hash(token), expiresAt: session.expiresAt, lastRotatedAt: now, ipHash: session.ipHash, userAgentHash: session.userAgentHash };
  let claimed: boolean;
  try {
    claimed = await deps.claim({ oldId: session.id, dueBefore: new Date(now.getTime() - SESSION_ROTATE_AFTER_MS), now, graceUntil: new Date(now.getTime() + SESSION_ROTATION_GRACE_MS), next });
  } catch {
    deps.log("failed"); // nothing was written to the cookie and the database did not half-apply
    return "failed";
  }
  if (!claimed) {
    deps.log("skipped_lost_race"); // the winner sets the new cookie; this response carries no session cookie at all
    return "skipped_lost_race";
  }

  // 3. The winner hands the browser the new token. If that fails the database is put back, so the
  //    browser's token and the database can never disagree.
  try {
    deps.setSessionCookie(token, session.expiresAt);
  } catch {
    try {
      await deps.revertClaim({ oldId: session.id, newId: next.id, previous });
    } catch {
      deps.log("revert_failed");
    }
    deps.log("failed");
    return "failed";
  }
  deps.log("rotated");
  return "rotated";
}
