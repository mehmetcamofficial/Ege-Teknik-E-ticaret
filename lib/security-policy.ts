export type AdminRole = "super_admin" | "admin" | "owner" | "operations_manager" | "catalog_manager" | "support_agent" | "viewer";
export type AdminPermission =
  | "catalog:write" | "orders:write" | "service:write" | "content:write" | "legal:write" | "admin:read"
  | "users:read" | "users:write" | "roles:write"
  | "integrations:read" | "integrations:write"
  | "payments:configure" | "security:write" | "audit:read";

export const adminRoles: readonly AdminRole[] = ["super_admin", "admin", "owner", "operations_manager", "catalog_manager", "support_agent", "viewer"];

/**
 * Phase 6D.1 matrix. "owner" is a frozen legacy row: it keeps its pre-6D.1
 * permissions, is never granted to new accounts, and never receives privileged
 * permissions. New privileged work uses "super_admin"; operational work uses "admin".
 * "admin" deliberately holds no legal:write (legal publishing is one-way) and no
 * privileged permissions at all - those come only via time-boxed grants, never
 * payments:configure (see maxGrantTtlHours).
 */
export const adminPermissions: Record<AdminRole, readonly AdminPermission[]> = {
  super_admin: ["catalog:write", "orders:write", "service:write", "content:write", "legal:write", "admin:read", "users:read", "users:write", "roles:write", "integrations:read", "integrations:write", "payments:configure", "security:write", "audit:read"],
  admin: ["catalog:write", "orders:write", "service:write", "content:write", "admin:read"],
  owner: ["catalog:write", "orders:write", "service:write", "content:write", "legal:write", "admin:read"],
  operations_manager: ["catalog:write", "orders:write", "service:write", "admin:read"],
  catalog_manager: ["catalog:write", "content:write", "admin:read"],
  support_agent: ["orders:write", "service:write", "admin:read"],
  viewer: ["admin:read"],
};

export function roleHasPermission(role: string, permission: AdminPermission): boolean {
  // Own-property check: a role value of "__proto__"/"constructor" otherwise reaches
  // Object.prototype and throws instead of denying.
  if (!Object.hasOwn(adminPermissions, role)) return false;
  return adminPermissions[role as AdminRole].includes(permission);
}

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const SESSION_ROTATE_AFTER_MS = 30 * 60 * 1000;
export const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export function isSessionActive(session: { expiresAt: Date; revokedAt: Date | null }, now: Date): boolean {
  return session.revokedAt === null && session.expiresAt.getTime() > now.getTime();
}

export function shouldRotateSession(lastRotatedAt: Date, now: Date): boolean {
  return now.getTime() - lastRotatedAt.getTime() > SESSION_ROTATE_AFTER_MS;
}

export const DEFAULT_MAX_BODY_BYTES = 64_000;
// Product image uploads carry a raw file (<=4 MB, enforced again server-side) plus
// multipart/form-data framing overhead; every other mutating /api/* route keeps the
// 64 KB JSON-body cap above.
export const IMAGE_UPLOAD_MAX_BODY_BYTES = 4_500_000;
const IMAGE_UPLOAD_PATH = /^\/api\/admin\/products\/[^/]+\/image$/;

/** The request-size ceiling the proxy enforces for a given API pathname. Narrowly
 * scoped: only the exact single-segment-id image-upload route gets the larger limit. */
export function maxBodyBytesForApiPath(pathname: string): number {
  return IMAGE_UPLOAD_PATH.test(pathname) ? IMAGE_UPLOAD_MAX_BODY_BYTES : DEFAULT_MAX_BODY_BYTES;
}

/**
 * Exact API paths called server-to-server by a payment provider, which sends no browser Origin. They skip only the
 * same-origin check in proxy.ts; the body-size cap still applies, and the handler must authenticate the caller
 * cryptographically (PayTR: HMAC hash) before touching any state.
 */
export const SERVER_TO_SERVER_API_PATHS: readonly string[] = ["/api/payments/paytr/callback"];
export function requiresSameOrigin(pathname: string): boolean {
  return !SERVER_TO_SERVER_API_PATHS.includes(pathname);
}

export function isSameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// ---- the client IP identity -------------------------------------------------------------------------------
/**
 * P3-S1A. The single place that decides "which client is this?", for every rate limiter and every
 * ipHash column in the application.
 *
 * WHY THIS IS NOT A SPOOF DEFENCE. This function parses a header; it does not authenticate one. On the
 * current deployment the header is set by the hosting platform before the request reaches this code:
 * Vercel documents that it OVERWRITES `X-Forwarded-For` and does not forward external IPs, explicitly to
 * prevent IP spoofing (https://vercel.com/docs/headers/request-headers). That platform guarantee - not
 * anything below - is what makes the identity trustworthy. On a host that forwards a caller's XFF, the
 * first element below would be caller-chosen; no parser can undo that. See
 * docs/operations/environment-contract.md.
 *
 * WHAT THIS DOES GUARANTEE, regardless of who set the header:
 *   - the identity is a syntactically valid IPv4 or IPv6 address, or the literal "unknown";
 *   - an arbitrary string can never become an identity, so a bucket can never be keyed on junk;
 *   - surrounding whitespace is normalised identically in BOTH headers (the previous x-real-ip branch
 *     did not trim, so " 1.2.3.4 " and "1.2.3.4" were two different buckets for one client);
 *   - nothing is logged, returned or persisted here. The caller hashes the result (hashWithSecret), and
 *     no raw address is ever written to the database.
 *
 * Deliberately NOT done, each a separate decision rather than an oversight: no trusted-hop counting, no
 * right-most XFF element, no TRUSTED_HOPS setting, and no use of x-vercel-forwarded-for. The first XFF
 * element is what Vercel documents as "the public IP address of the client", so it stays the first
 * element; the alternatives would change the trust model, which this slice explicitly does not do.
 */

/** Matches inet_pton's IPv4 strictness: four dotted decimal octets, 0-255, and NO leading zeros. */
const IPV4_OCTET = /^(?:0|[1-9]\d{0,2})$/;
const IPV6_HEXTET = /^[0-9a-fA-F]{1,4}$/;

function isIpv4Address(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => IPV4_OCTET.test(part) && Number(part) <= 255);
}

function isIpv6Address(value: string): boolean {
  // Only hex digits, colons and dots. This rejects an IPv6 zone id ("fe80::1%eth0"), which node:net's isIP
  // does accept: a zone id names a local interface on one host, never travels in a forwarding header, and
  // accepting it would let one client spell one address two ways and land in two buckets. That is the only
  // place this validator is stricter than the standard; tests/client-ip.test.ts pins that against isIP().
  if (!value || !/^[0-9a-fA-F:.]+$/.test(value)) return false;
  let text = value;
  if (text.includes(".")) {
    // A trailing dotted-quad ("::ffff:1.2.3.4") occupies the last two hextets; "0:0" keeps the count right.
    const embedded = text.slice(text.lastIndexOf(":") + 1);
    if (!isIpv4Address(embedded)) return false;
    text = `${text.slice(0, text.lastIndexOf(":") + 1)}0:0`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return false; // "::" may appear at most once
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : null;
  if (![...head, ...(rest ?? [])].every((hextet) => IPV6_HEXTET.test(hextet))) return false;
  // Without "::" there must be exactly eight hextets; with it, "::" must stand for at least one.
  return rest === null ? head.length === 8 : head.length + rest.length < 8;
}

function isIpAddress(value: string): boolean {
  return value.includes(":") ? isIpv6Address(value) : isIpv4Address(value);
}

/**
 * The client identity, or "unknown" when no header carried a usable address. Kept in this module because
 * it is the module every other security rule already lives in - and because it must stay importable by
 * the browser (an admin client component reads this file) and by proxy.ts on the Edge runtime, which is
 * why it is written without any node:* import. tests/client-ip.test.ts pins it to node:net's own isIP().
 */
export function trustedClientIp(headers: Pick<Headers, "get">): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  if (isIpAddress(forwarded)) return forwarded;
  const real = headers.get("x-real-ip")?.trim() ?? "";
  return isIpAddress(real) ? real : "unknown";
}

const prohibitedCardKeys = /^(pan|card_?number|credit_?card|cvv|cvc|expiry|expiration|expiration_?date)$/i;

export function containsCardData(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsCardData);
  return Object.entries(value).some(([key, item]) => prohibitedCardKeys.test(key) || containsCardData(item));
}

export function isBucketWindowActive(bucket: { expiresAt: Date } | undefined, now: Date): boolean {
  return Boolean(bucket && bucket.expiresAt.getTime() > now.getTime());
}

export function rateLimitExceeded(bucket: { count: number; expiresAt: Date } | undefined, now: Date, limit: number): boolean {
  return isBucketWindowActive(bucket, now) && bucket!.count >= limit;
}

export function isValidIdempotencyKey(value: string | null | undefined): boolean {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{8,200}$/.test(value);
}

// ---- Phase 6D.1: privileged governance -----------------------------------------------------------
// All durations are HOURS. Invitation ceiling is 72 HOURS (never "72s" anywhere).

/** Maximum invitation lifetime, in hours. Enforced by DB CHECK and route Zod. */
export const ADMIN_INVITE_MAX_TTL_HOURS = 72;
/** Selectable operational grant durations, in hours (1h / 8h / 24h / 7 days). */
export const OPERATIONAL_GRANT_PRESETS_HOURS: readonly number[] = [1, 8, 24, 168];
/** Hard ceiling for operational grants, in hours (7 days). DB CHECK backstop. */
export const OPERATIONAL_GRANT_MAX_HOURS = 168;
/** Hard ceiling for privileged grants (users:write, roles:write, security:write), in hours. Code-enforced. */
export const PRIVILEGED_GRANT_MAX_HOURS = 24;

/** Privileged permissions subject to the 24-hour grant ceiling. */
export const PRIVILEGED_GRANT_PERMISSIONS: readonly AdminPermission[] = ["users:write", "roles:write", "security:write"];

/**
 * Maximum grantable TTL for a permission, in hours.
 * payments:configure returns 0 = UNGRANTABLE: it stays Super-Admin-only and can
 * never flow through a temporary grant (DB CHECK + Zod + this function triple-lock it).
 */
export function maxGrantTtlHours(permission: AdminPermission): number {
  if (permission === "payments:configure") return 0;
  if ((PRIVILEGED_GRANT_PERMISSIONS as readonly string[]).includes(permission)) return PRIVILEGED_GRANT_MAX_HOURS;
  return OPERATIONAL_GRANT_MAX_HOURS;
}

/** Only super_admin counts as privileged. Legacy owner is deliberately excluded. */
export function isPrivilegedRole(role: string): boolean {
  return role === "super_admin";
}

/** A grant authorizes only while unrevoked and unexpired (server clock, per request). */
export function isGrantActive(grant: { revokedAt: Date | null; expiresAt: Date }, now: Date): boolean {
  return grant.revokedAt === null && grant.expiresAt.getTime() > now.getTime();
}

/**
 * Last-active-super-admin guard (pure): removing the final recovery authority is
 * refused whether the operation is a deactivate, a demote, or any equivalent removal.
 */
export function canRemovePrivileged(input: { activeSuperAdminCount: number; targetIsActiveSuperAdmin: boolean }): boolean {
  if (!input.targetIsActiveSuperAdmin) return true;
  return input.activeSuperAdminCount > 1;
}

/**
 * Secret-leak guard for audit payloads and API responses: secret-shaped keys must
 * never reach audit_logs, JSON responses, HTML, or client state. Returns the
 * offending key, or null when clean.
 */
// camelCase is covered too (tokenHash), not only snake_case (token_hash), because the same
// guard has to hold for every audit payload the application writes.
const secretKeyPattern = /password|passwd|secret|api[_-]?key|merchant[_-]?key|private[_-]?key|cipher|token[_-]?hash|raw[_-]?token|\btoken\b|credential/i;
export function findSecretLeak(value: unknown, seen = new Set<unknown>()): string | null {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findSecretLeak(item, seen);
      if (hit) return hit;
    }
    return null;
  }
  for (const [key, item] of Object.entries(value)) {
    if (secretKeyPattern.test(key)) return key;
    const hit = findSecretLeak(item, seen);
    if (hit) return hit;
  }
  return null;
}
