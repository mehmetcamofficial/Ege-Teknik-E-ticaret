export type AdminRole = "owner" | "operations_manager" | "catalog_manager" | "support_agent" | "viewer";
export type AdminPermission = "catalog:write" | "orders:write" | "service:write" | "content:write" | "legal:write" | "admin:read";

export const adminRoles: readonly AdminRole[] = ["owner", "operations_manager", "catalog_manager", "support_agent", "viewer"];
export const adminPermissions: Record<AdminRole, readonly AdminPermission[]> = {
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
