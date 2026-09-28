/**
 * Two script policies, because the deployment serves two different kinds of document.
 *
 * - "static": the storefront shipped from public/*.html. Its fixed inline scripts are
 *   allowlisted by sha256 hash and external runtime script CDNs are not required.
 * - "app": Next.js-rendered documents (/admin). Next emits per-request inline bootstrap
 *   scripts whose content varies, so those carry a per-request nonce instead.
 * - "account": the same nonce model plus only the exact Clerk frontend origin encoded
 *   in the publishable key. No wildcard or scheme-wide script source is accepted.
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

/**
 * The contact page embeds the verified business location as a Google Maps iframe (Paket 1E).
 * Only that exact origin may be framed; the embed runs inside Google's own document, so no
 * script, style or connect source is added for it.
 */
export const STATIC_FRAME_SOURCES = ["https://www.google.com"] as const;

export function staticContentSecurityPolicy(scriptHashes: readonly string[]): string {
  const sources = ["'self'", ...scriptHashes.map((hash) => `'${hash}'`)];
  return [`script-src ${sources.join(" ")}`, `frame-src ${STATIC_FRAME_SOURCES.join(" ")}`, ...sharedDirectives].join("; ");
}

export function appContentSecurityPolicy(nonce: string): string {
  return [`script-src 'self' 'nonce-${nonce}'`, ...sharedDirectives].join("; ");
}

export function clerkFrontendOrigin(publishableKey: string | undefined): string {
  if (!publishableKey || !/^pk_(test|live)_/.test(publishableKey)) throw new Error("A valid Clerk publishable key is required for the account CSP.");
  const encoded = publishableKey.replace(/^pk_(test|live)_/, "");
  let decoded: string;
  try {
    decoded = atob(encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "="));
  } catch {
    throw new Error("A valid Clerk publishable key is required for the account CSP.");
  }
  const hostname = decoded.endsWith("$") ? decoded.slice(0, -1) : "";
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(hostname)) {
    throw new Error("A valid Clerk publishable key is required for the account CSP.");
  }
  return `https://${hostname.toLowerCase()}`;
}

export function accountContentSecurityPolicy(nonce: string, clerkOrigin: string): string {
  const accountDirectives = sharedDirectives.map((directive) => directive.startsWith("connect-src ")
    ? `connect-src 'self' ${clerkOrigin} https://clerk-telemetry.com`
    : directive);
  return [
    `script-src 'self' 'nonce-${nonce}' ${clerkOrigin} https://challenges.cloudflare.com`,
    ...accountDirectives,
    `frame-src 'self' ${clerkOrigin} https://challenges.cloudflare.com`,
    "worker-src 'self' blob:",
  ].join("; ");
}

export const staticSecurityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "X-Frame-Options", value: "DENY" },
] as const;
