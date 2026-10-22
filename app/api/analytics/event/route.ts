import { publicRoute, rateLimit, readJson } from "@/lib/http-security";
import { analyticsEventSchema, extractReferrerHost, isValidVisitorId, readCookie, VISITOR_COOKIE_MAX_AGE_SECONDS, VISITOR_COOKIE_NAME } from "@/lib/analytics";
import { recordEvent } from "@/lib/analytics-db";

const noStore = { "cache-control": "no-store" };
const ACCEPTED = { ok: true };
const ANALYTICS_CONSENT_COOKIE_NAME = "ege_analytics_consent";

function analyticsEnabled() {
  // Global emergency/operations switch. Production should set this to true only when
  // the preference UI is deployed; per-visitor collection is still gated separately.
  return process.env.ANALYTICS_ENABLED === "true";
}

function analyticsConsentGranted(request: Request) {
  return readCookie(request.headers.get("cookie"), ANALYTICS_CONSENT_COOKIE_NAME) === "1";
}

function visitorCookieHeader(value: string, secure: boolean, maxAge = VISITOR_COOKIE_MAX_AGE_SECONDS) {
  return `${VISITOR_COOKIE_NAME}=${value}; Max-Age=${maxAge}; Path=/; SameSite=Strict; HttpOnly${secure ? "; Secure" : ""}`;
}

/**
 * Public, unauthenticated, first-party page/product-view collection.
 * Two gates must both be open: the global ANALYTICS_ENABLED kill-switch and the
 * visitor's explicit analytics preference cookie. Without either, nothing is recorded
 * and no analytics visitor id is created.
 */
async function ingest(request: Request) {
  if (!analyticsEnabled() || !analyticsConsentGranted(request)) {
    return new Response(null, { status: 204, headers: noStore });
  }

  await rateLimit(request, "analytics-event", 120, 10 * 60_000);
  const parsed = analyticsEventSchema.safeParse(await readJson(request, 2_000));
  if (!parsed.success) return Response.json({ error: "Geçersiz istek." }, { status: 400, headers: noStore });

  const existing = readCookie(request.headers.get("cookie"), VISITOR_COOKIE_NAME);
  const hadValidCookie = isValidVisitorId(existing);
  const visitorId = hadValidCookie ? existing! : crypto.randomUUID();
  const referrerHost = extractReferrerHost(parsed.data.referrer, new URL(request.url).origin);

  await recordEvent({ visitorId, path: parsed.data.path, productId: parsed.data.productId, referrerHost, userAgent: request.headers.get("user-agent") });

  const response = Response.json(ACCEPTED, { status: 202, headers: noStore });
  if (!hadValidCookie) response.headers.set("Set-Cookie", visitorCookieHeader(visitorId, process.env.NODE_ENV === "production"));
  return response;
}

/** Clearing the HttpOnly analytics id must be server-side; JS cannot delete it directly. */
async function revokeAnalytics(request: Request) {
  const response = new Response(null, { status: 204, headers: noStore });
  response.headers.set("Set-Cookie", visitorCookieHeader("", new URL(request.url).protocol === "https:", 0));
  return response;
}

export const POST = publicRoute(ingest);
export const DELETE = publicRoute(revokeAnalytics);
