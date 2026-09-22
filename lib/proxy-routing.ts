/**
 * Pure request-path classification for proxy.ts's dispatch, kept free of any
 * next/server or @clerk/* import so it can be unit tested directly (those
 * packages' ESM builds aren't resolvable under the plain `node --test`
 * runner this project uses - see tests/proxy-routing.test.ts).
 */
export type ProxyRoute = "api" | "account" | "admin-app";

export function classifyProxyRoute(pathname: string): ProxyRoute {
  if (pathname.startsWith("/api/")) return "api";
  if (pathname === "/account" || pathname.startsWith("/account/")) return "account";
  return "admin-app";
}

/**
 * The only paths proxy.ts ever runs for. Anything not matched here (the
 * static storefront, /account excluded, etc.) reaches Next.js/the public
 * folder directly, untouched by Clerk, the admin CSP nonce, or the API
 * guards.
 *
 * Kept here only for tests/proxy-routing.test.ts to assert against - proxy.ts
 * itself must keep this same array as a literal in its own `config.matcher`
 * export, since Next.js parses that field statically at build time and
 * cannot follow an imported reference. Keep the two in sync by hand.
 */
export const PROXY_MATCHER = ["/api/:path*", "/admin/:path*", "/account/:path*"] as const;
