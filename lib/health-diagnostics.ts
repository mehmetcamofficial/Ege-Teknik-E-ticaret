/**
 * Minimal health-check diagnostics. Never log error.message, detail, hint,
 * stack, connection strings, usernames, or arbitrary driver error codes.
 * PostgreSQL SQLSTATE and a few well-known network/TLS codes are allowlisted.
 */
const CODES = new Set([
  "28P01", "28000", "3D000", "42501", "53300", "57P01", "08001", "08003", "08006", "08P01",
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN",
  "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT",
  "DEPTH_ZERO_SELF_SIGNED_CERT", "ERR_TLS_CERT_ALTNAME_INVALID",
]);

export type HealthFailurePhase = "pool_init" | "db_query";

export function safeHealthErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "OTHER";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && CODES.has(code) ? code : "OTHER";
}

export function logHealthFailure(phase: HealthFailurePhase, error: unknown): void {
  console.error("health_check_failed", { phase, code: safeHealthErrorCode(error) });
}
