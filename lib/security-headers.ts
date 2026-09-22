/**
 * Two script policies, because the deployment serves two different kinds of document.
 *
 * - "static": the legacy storefront shipped from public/*.html. Its inline scripts are
 *   fixed file content, so they are allowlisted by sha256 hash and need no 'unsafe-inline'.
 *   It still loads the Tailwind Play CDN, which is an explicit external script source.
 * - "app": Next.js-rendered documents (/admin). Next emits per-request inline bootstrap
 *   scripts whose content varies, so those carry a per-request nonce instead.
 *
 * style-src keeps 'unsafe-inline': the Tailwind Play CDN injects generated <style> blocks at
 * runtime, so removing it would break the storefront's styling. This is a real remaining gap,
 * not a solved one - see the Phase 3A.1 report.
 */

export const TAILWIND_CDN_ORIGIN = "https://cdn.tailwindcss.com";

const sharedDirectives = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "upgrade-insecure-requests",
];

export function staticContentSecurityPolicy(scriptHashes: readonly string[]): string {
  const sources = ["'self'", TAILWIND_CDN_ORIGIN, ...scriptHashes.map((hash) => `'${hash}'`)];
  return [`script-src ${sources.join(" ")}`, ...sharedDirectives].join("; ");
}

export function appContentSecurityPolicy(nonce: string): string {
  return [`script-src 'self' 'nonce-${nonce}'`, ...sharedDirectives].join("; ");
}

export const staticSecurityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "X-Frame-Options", value: "DENY" },
] as const;
