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

/**
 * Bootstrap exists only to create the very first administrator. Requiring a zero
 * admin count (rather than "this email has no account") stops the credential from
 * minting fresh owners later, including after an admin is deleted or deactivated.
 */
export function canBootstrapAdmin(input: {
  adminCount: number;
  configuredEmail: string | undefined;
  configuredPasswordHash: string | undefined;
  submittedEmail: string;
}): boolean {
  if (input.adminCount !== 0) return false;
  if (!input.configuredEmail || !input.configuredPasswordHash) return false;
  return input.configuredEmail.trim().toLowerCase() === input.submittedEmail.trim().toLowerCase();
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

export function isSameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
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
