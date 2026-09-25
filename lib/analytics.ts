import { z } from "zod";

/**
 * First-party analytics domain logic (Phase 6A) - pure, framework-free (no next/*, db, or
 * Request import), same discipline as lib/order-domain.ts and lib/customer-identity.ts, so
 * every rule here is unit-testable without a server or a database.
 *
 * PRIVACY MODEL - read this before touching anything below:
 *
 * - visitor_id: a random v4 UUID, generated server-side with crypto.randomUUID() the first
 *   time a browser is seen with no (or an invalid) `ege_vid` cookie, then round-tripped in a
 *   first-party, httpOnly, SameSite=Strict cookie (page JS never reads or writes it directly -
 *   see public/store.js's sendAnalyticsEvent) for up to VISITOR_COOKIE_MAX_AGE_SECONDS
 *   (180 days). It is NOT derived from the IP address, user agent, or any other request
 *   characteristic - it carries no fingerprinting signal on its own, cannot be linked to a
 *   person, and is never sent to, or readable by, any other origin. Clearing cookies or
 *   blocking storage simply starts a new anonymous id; nothing is lost or degraded elsewhere.
 * - Raw IP addresses are NEVER stored by analytics. Rate-limiting the ingestion endpoint
 *   reuses lib/http-security.ts's existing hashClientIp/rateLimit (a salted hash, in the
 *   pre-existing rate_limit_buckets table) - analytics_events itself has no IP column at all.
 * - Raw user-agent strings are NEVER stored. classifyDevice/isBotUserAgent read the header
 *   once at ingestion time and only the *classification result* (device category, is_bot) is
 *   persisted.
 * - Referrer is reduced to a bare hostname (never the full URL, which can carry a third
 *   party's query string) and only kept when it is a different origin from this site - an
 *   internal navigation is not a "traffic source".
 * - is_new_visitor is decided by the server (has this visitor_id ever appeared before?), never
 *   accepted from the client, so it cannot be spoofed to skew the metric.
 */

// ---- ingestion request --------------------------------------------------------------------------
/** The path only, no query string/fragment, a plain site-relative page identifier - never a full URL. */
export const analyticsEventSchema = z.object({
  // A single leading slash only - "//host/path" is protocol-relative URL syntax, not a page path,
  // and must never be accepted as one (defense in depth, matching safeInternalHref elsewhere).
  path: z.string().trim().min(1).max(200).regex(/^\/(?!\/)[^\s?#]*$/, "path must be a bare site-relative path"),
  productId: z.string().trim().min(1).max(160).optional(),
  // What the browser reports as document.referrer for this visit's entry page - the ONLY
  // reason a full URL is ever accepted from the client, and only its hostname is kept (see
  // extractReferrerHost). Absent on every subsequent same-visit page view.
  referrer: z.string().trim().max(500).optional(),
}).strict();
export type AnalyticsEventInput = z.infer<typeof analyticsEventSchema>;

const VISITOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isValidVisitorId(value: unknown): value is string {
  return typeof value === "string" && VISITOR_ID.test(value);
}
export const VISITOR_COOKIE_NAME = "ege_vid";
export const VISITOR_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60; // 180 days

/** RFC 6265-ish single-cookie-jar reader: good enough for one first-party cookie we control. */
export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

// ---- device / bot classification -----------------------------------------------------------------
/**
 * Coarse, well-known heuristics only - no fingerprinting (no canvas/font/screen probing, no
 * combining signals into a unique key). Best-effort: a bot that deliberately impersonates a
 * normal browser's user agent (e.g. a headless-Chrome scraper with the telltale strings
 * stripped) will not be caught. That is a documented limitation, not a claim of completeness.
 */
export function classifyDevice(userAgent: string | null | undefined): "mobile" | "tablet" | "desktop" {
  const ua = String(userAgent ?? "");
  if (/iPad|Android(?!.*Mobile)|Tablet|Kindle|Silk/i.test(ua)) return "tablet";
  if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry/i.test(ua)) return "mobile";
  return "desktop";
}

const BOT_PATTERNS = [
  // search/crawl/preview bots
  /bot|spider|crawl|slurp|crawler/i,
  /googlebot|bingbot|yandexbot|baiduspider|duckduckbot|applebot|petalbot|bytespider/i,
  /facebookexternalhit|twitterbot|linkedinbot|slackbot|telegrambot|discordbot|whatsapp|pinterest|embedly|outbrain|quora link preview|w3c_validator|showyoubot/i,
  /ahrefsbot|semrushbot|mj12bot|dotbot|gptbot|ccbot|claudebot|perplexitybot/i,
  // headless/automation tooling
  /headlesschrome|phantomjs|puppeteer|playwright|selenium/i,
  // plain HTTP clients / scripts (a real browser never identifies itself this way)
  /curl\/|wget\/|python-requests|python-urllib|go-http-client|java\/|okhttp|node-fetch|axios\/|libwww-perl|scrapy|postmanruntime/i,
];
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  const ua = String(userAgent ?? "").trim();
  if (!ua) return true; // a real browser always sends a User-Agent
  return BOT_PATTERNS.some((p) => p.test(ua));
}

// ---- referrer --------------------------------------------------------------------------------
/** Bare hostname of an external referrer, or null for same-site, missing, or unparseable input. Never the full URL. */
export function extractReferrerHost(referrer: string | null | undefined, siteOrigin: string): string | null {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    if (!/^https?:$/.test(url.protocol)) return null;
    const site = new URL(siteOrigin);
    if (url.hostname === site.hostname) return null; // internal navigation is not a traffic source
    return url.hostname.toLowerCase().slice(0, 200);
  } catch { return null; }
}

// ---- path normalisation --------------------------------------------------------------------------
/** Strips query string/fragment; the schema already rejects anything not already bare, this just defends the DB layer too. */
export function normalizeEventPath(path: string): string {
  return path.split("?")[0]!.split("#")[0]!.slice(0, 200);
}

// ---- date ranges (Europe/Istanbul, permanently UTC+3 since 2016 - no DST, no tz database needed) --
const TR_OFFSET_MS = 3 * 60 * 60 * 1000;
export const dateRangePresets = ["today", "7d", "30d", "month", "year", "custom"] as const;
export type DateRangePreset = (typeof dateRangePresets)[number];

/** Midnight Europe/Istanbul, expressed as the equivalent UTC instant. */
function trMidnightUtc(utcInstant: Date): Date {
  const trLocal = new Date(utcInstant.getTime() + TR_OFFSET_MS);
  const y = trLocal.getUTCFullYear(), m = trLocal.getUTCMonth(), d = trLocal.getUTCDate();
  return new Date(Date.UTC(y, m, d) - TR_OFFSET_MS);
}
function addDays(date: Date, days: number): Date { return new Date(date.getTime() + days * 24 * 60 * 60 * 1000); }

export type ResolvedRange = { start: Date; end: Date };
export type DateRangeResult = { ok: true; range: ResolvedRange } | { ok: false; error: string };

/**
 * `now` and, for "custom", `from`/`to` are the only inputs; every boundary is computed from
 * them so this is exactly reproducible in a test. `end` is always exclusive-of-future (capped
 * at `now`), so a range never silently promises data that has not happened yet.
 */
export function resolveDateRange(preset: DateRangePreset, now: Date, from?: string, to?: string): DateRangeResult {
  const todayStart = trMidnightUtc(now);
  switch (preset) {
    case "today": return { ok: true, range: { start: todayStart, end: now } };
    case "7d": return { ok: true, range: { start: addDays(todayStart, -6), end: now } };
    case "30d": return { ok: true, range: { start: addDays(todayStart, -29), end: now } };
    case "month": {
      const trLocal = new Date(now.getTime() + TR_OFFSET_MS);
      const start = new Date(Date.UTC(trLocal.getUTCFullYear(), trLocal.getUTCMonth(), 1) - TR_OFFSET_MS);
      return { ok: true, range: { start, end: now } };
    }
    case "year": {
      const trLocal = new Date(now.getTime() + TR_OFFSET_MS);
      const start = new Date(Date.UTC(trLocal.getUTCFullYear(), 0, 1) - TR_OFFSET_MS);
      return { ok: true, range: { start, end: now } };
    }
    case "custom": {
      if (!from || !to) return { ok: false, error: "custom range requires from and to" };
      // A bare "YYYY-MM-DD" (exactly what a native <input type=date> sends) is interpreted as
      // an Istanbul calendar day, not UTC midnight: `from` is the start of that day and `to` is
      // the END of that day, so picking the same day for both covers that whole day rather than
      // an instant. A full ISO timestamp is used exactly as given, unchanged.
      const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
      const start = DATE_ONLY.test(from) ? trMidnightUtc(new Date(from + "T12:00:00Z")) : new Date(from);
      const end = DATE_ONLY.test(to) ? new Date(addDays(trMidnightUtc(new Date(to + "T12:00:00Z")), 1).getTime() - 1) : new Date(to);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { ok: false, error: "invalid date" };
      if (start > end) return { ok: false, error: "from must not be after to" };
      const MAX_SPAN_MS = 400 * 24 * 60 * 60 * 1000; // generous cap: over a year, never truly unbounded
      if (end.getTime() - start.getTime() > MAX_SPAN_MS) return { ok: false, error: "range too large" };
      return { ok: true, range: { start, end: end > now ? now : end } };
    }
  }
}

export const analyticsQuerySchema = z.object({
  range: z.enum(dateRangePresets).default("7d"),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
});

// ---- public projection (admin dashboard) -----------------------------------------------------
export type DeviceCategory = "mobile" | "tablet" | "desktop";
export type AnalyticsSummary = {
  range: { start: string; end: string };
  totals: { visitors: number; uniqueVisitors: number; pageViews: number; newVisitors: number; returningVisitors: number };
  today: number; thisWeek: number; thisMonth: number; thisYear: number;
  dailyTrend: { date: string; visitors: number; pageViews: number }[];
  topPages: { path: string; views: number }[];
  topProducts: { productId: string; productName: string; views: number }[];
  devices: Record<DeviceCategory, number>;
  referrers: { host: string; visits: number }[];
  botEventsExcluded: number;
};
