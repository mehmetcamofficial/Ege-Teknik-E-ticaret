import { NextRequest, NextResponse } from "next/server";
import { appContentSecurityPolicy } from "@/lib/security-headers";
import { isSameOrigin, maxBodyBytesForApiPath } from "@/lib/security-policy";

const mutating = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function guardApiRequest(request: NextRequest): NextResponse | null {
  if (!mutating.has(request.method)) return null;
  const maxBytes = maxBodyBytesForApiPath(request.nextUrl.pathname);
  if (Number(request.headers.get("content-length") || 0) > maxBytes) return NextResponse.json({ error: "İstek boyutu çok büyük." }, { status: 413 });
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!isSameOrigin(request.headers.get("origin"), host)) return NextResponse.json({ error: "İstek kaynağı reddedildi." }, { status: 403 });
  return null;
}

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) return guardApiRequest(request) ?? NextResponse.next();

  // Next.js reads the nonce out of the request CSP header and stamps it onto the inline
  // bootstrap scripts it emits, so those need no 'unsafe-inline'.
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const csp = appContentSecurityPolicy(nonce);
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = { matcher: ["/api/:path*", "/admin/:path*"] };
