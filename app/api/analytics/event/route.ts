import { publicRoute, rateLimit, readJson } from "@/lib/http-security";
import { analyticsEventSchema, extractReferrerHost, isValidVisitorId, readCookie, VISITOR_COOKIE_MAX_AGE_SECONDS, VISITOR_COOKIE_NAME } from "@/lib/analytics";
import { recordEvent } from "@/lib/analytics-db";

const noStore = { "cache-control": "no-store" };
/** One reply for every accepted event, whatever it turned out to be (new/returning, bot or not) - nothing about the classification is ever observable by the client. */
const ACCEPTED = { ok: true };

function visitorCookieHeader(value: string, secure: boolean) {
  return `${VISITOR_COOKIE_NAME}=${value}; Max-Age=${VISITOR_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Strict; HttpOnly${secure ? "; Secure" : ""}`;
}

/**
 * Public, unauthenticated, first-party page/product-view collection. See lib/analytics.ts's
 * module doc for the full privacy model (no raw IP, no raw UA, no fingerprinting, no cross-site
 * cookie). Rate-limited the same way review/order submission is; a failure here is always a
 * 4xx/5xx the storefront already treats as "best effort, ignore and move on" (see public/store.js).
 */
async function ingest(request: Request) {
  await rateLimit(request, "analytics-event", 120, 10 * 60_000);
  const parsed = analyticsEventSchema.safeParse(await readJson(request, 2_000));
  if (!parsed.success) return Response.json({ error: "Geçersiz istek." }, { status: 400, headers: noStore });

  const existing = readCookie(request.headers.get("cookie"), VISITOR_COOKIE_NAME);
  const hadValidCookie = isValidVisitorId(existing);
  const visitorId = hadValidCookie ? existing! : crypto.randomUUID();
  const referrerHost = extractReferrerHost(parsed.data.referrer, new URL(request.url).origin);

  await recordEvent({ visitorId, path: parsed.data.path, productId: parsed.data.productId, referrerHost, userAgent: request.headers.get("user-agent") });

  const response = Response.json(ACCEPTED, { status: 202, headers: noStore });
  // Only a freshly-minted id needs to be written back; an id the browser already sent us is already stored.
  if (!hadValidCookie) response.headers.set("Set-Cookie", visitorCookieHeader(visitorId, process.env.NODE_ENV === "production"));
  return response;
}

export const POST = publicRoute(ingest);
