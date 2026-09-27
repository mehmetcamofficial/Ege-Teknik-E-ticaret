/**
 * Two script policies, because the deployment serves two different kinds of document.
 *
 * - "static": the storefront shipped from public/*.html. Its fixed inline scripts are
 *   allowlisted by sha256 hash and external runtime script CDNs are not required.
 * - "app": Next.js-rendered documents (/admin). Next emits per-request inline bootstrap
 *   scripts whose content varies, so those carry a per-request nonce instead.
 *
 * style-src still keeps 'unsafe-inline' because the current storefront contains inline
 * style attributes / style blocks. Storefront fonts/icons are now local/system-based, so
 * Google Fonts origins are no longer required by CSP.
 */

const sharedDirectives = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "upgrade-insecure-requests",
];

export function staticContentSecurityPolicy(scriptHashes: readonly string[]): string {
  const sources = ["'self'", ...scriptHashes.map((hash) => `'${hash}'`)];
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
