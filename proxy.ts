import { NextRequest, NextResponse, type NextFetchEvent } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";
import { appContentSecurityPolicy } from "@/lib/security-headers";
import { isSameOrigin, maxBodyBytesForApiPath } from "@/lib/security-policy";
import { classifyProxyRoute } from "@/lib/proxy-routing";

const mutating = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function guardApiRequest(request: NextRequest): NextResponse | null {
  if (!mutating.has(request.method)) return null;
  const maxBytes = maxBodyBytesForApiPath(request.nextUrl.pathname);
  if (Number(request.headers.get("content-length") || 0) > maxBytes) return NextResponse.json({ error: "İstek boyutu çok büyük." }, { status: 413 });
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!isSameOrigin(request.headers.get("origin"), host)) return NextResponse.json({ error: "İstek kaynağı reddedildi." }, { status: 403 });
  return null;
}

/**
 * Clerk only ever runs for /account. It populates auth() context and passes
 * through unconditionally — the actual signed-in check is a resource-based
 * auth.protect() in app/account/layout.tsx, which is Clerk's current
 * recommended pattern (route-matcher-based protection here is deprecated).
 * /api and /admin never touch this handler, so Clerk cannot influence them.
 */
const withClerk = clerkMiddleware(() => NextResponse.next());

export function proxy(request: NextRequest, event: NextFetchEvent) {
  const route = classifyProxyRoute(request.nextUrl.pathname);

  if (route === "api") return guardApiRequest(request) ?? NextResponse.next();
  if (route === "account") return withClerk(request, event);

  // route === "admin-app": Next.js reads the nonce out of the request CSP header and
  // stamps it onto the inline bootstrap scripts it emits, so those need no 'unsafe-inline'.
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const csp = appContentSecurityPolicy(nonce);
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

// Next.js requires this array as a static literal here (it's parsed at build time,
// not evaluated) - keep in sync with lib/proxy-routing.ts's PROXY_MATCHER, which
// tests/proxy-routing.test.ts asserts against.
export const config = { matcher: ["/api/:path*", "/admin/:path*", "/account/:path*"] };
