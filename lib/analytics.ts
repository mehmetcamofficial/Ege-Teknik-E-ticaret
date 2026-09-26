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
export const dateRangePresets = ["today", "7d", "30d", "90d", "month", "year", "custom"] as const;
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
    case "90d": return { ok: true, range: { start: addDays(todayStart, -89), end: now } };
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

// ---- previous period & trend granularity (Phase 3.3B) --------------------------------------------
// A comparison period is only meaningful if it is the window IMMEDIATELY BEFORE the current one and
// is exactly as long as it. Both rules are enforced here, from the already-resolved current range, so
// every caller gets the same answer and "previous" can never silently become some other period.
function previousRangeFor(preset: DateRangePreset, current: ResolvedRange, now: Date): ResolvedRange {
  const trNow = new Date(now.getTime() + TR_OFFSET_MS);
  if (preset === "month") {
    // The previous CALENDAR month, not "the last 30 days": a month-to-date comparison against a
    // rolling 30-day window would be an apples-to-oranges delta.
    const start = new Date(Date.UTC(trNow.getUTCFullYear(), trNow.getUTCMonth() - 1, 1) - TR_OFFSET_MS);
    return { start, end: current.start };
  }
  if (preset === "year") {
    const start = new Date(Date.UTC(trNow.getUTCFullYear() - 1, 0, 1) - TR_OFFSET_MS);
    return { start, end: current.start };
  }
  if (preset === "custom") {
    // Same length, shifted back by exactly that length so the two windows abut and never overlap.
    const length = current.end.getTime() - current.start.getTime();
    return { start: new Date(current.start.getTime() - length), end: current.start };
  }
  // today/7d/30d/90d: a rolling window, so the comparison is the same-length window ending where
  // this one begins. For "today" the length is the elapsed part of the day, not a whole day.
  const length = current.end.getTime() - current.start.getTime();
  return { start: new Date(current.start.getTime() - length), end: current.start };
}

/**
 * The comparison window for `preset`, or a failure carrying the same reason the current range would
 * have failed with. Never throws and never returns a period that reaches into the future.
 */
export function resolvePreviousRange(preset: DateRangePreset, now: Date, from?: string, to?: string): DateRangeResult {
  const current = resolveDateRange(preset, now, from, to);
  if (!current.ok) return current;
  const previous = previousRangeFor(preset, current.range, now);
  // A preset whose previous window would start before the epoch cap would be unbounded; the same
  // 400-day rule the current range enforces applies here, so a comparison is never unbounded either.
  if (previous.end.getTime() - previous.start.getTime() > 400 * 24 * 60 * 60 * 1000) return { ok: false, error: "range too large" };
  return { ok: true, range: previous };
}

export const trendGranularities = ["day", "week", "month"] as const;
export type TrendGranularity = typeof trendGranularities[number];

/**
 * How finely a trend should be bucketed for a given range. Purely a function of how many days the
 * range spans, so a custom range gets a sensible bucket too. Chosen so no chart exceeds ~60 points:
 * 30 days of daily bars is readable, 365 days of them is not.
 */
export function trendGranularityFor(range: ResolvedRange): TrendGranularity {
  const days = (range.end.getTime() - range.start.getTime()) / (24 * 60 * 60 * 1000);
  if (days <= 45) return "day";
  if (days <= 200) return "week";
  return "month";
}

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

// ---- Sales analytics (Phase 3.3B) -----------------------------------------------------------------
/**
 * FINANCE SEMANTICS - the single most important thing in this file, read before adding a number:
 *
 * `orderValue` is the sum of `orders.total` - the amount customers were ASKED to pay, VAT-inclusive.
 * It is deliberately called "Sipariş Tutarı" everywhere in the UI and is NEVER called "ciro" or
 * "tahsilat": no payment provider is integrated, `payments`/`refunds` are never written, and
 * `orders.payment_status` is an operator's manual dropdown, not a gateway confirmation. Nothing here
 * may ever be derived from it, and nothing here represents money actually collected.
 *
 * Every field below is an aggregate. No order row, no customer id, no name, phone, email or address
 * is ever selected into this projection - the sales endpoint exists precisely so the browser never
 * has to hold order-level personal data to draw a chart.
 */
export type SalesTotals = {
  orderValue: number;
  netOrderValue: number;
  vatTotal: number;
  orderCount: number;
  unitsSold: number;
  averageOrderValue: number | null;
  cancelledCount: number;
  cancellationRate: number | null;
};

export type SalesTrendPoint = { bucket: string; orderValue: number; orderCount: number };
export type SalesStatusPoint = { status: string; count: number; orderValue: number };

export type SalesSummary = {
  range: { start: string; end: string };
  previousRange: { start: string; end: string };
  granularity: TrendGranularity;
  totals: SalesTotals;
  previous: SalesTotals;
  trend: SalesTrendPoint[];
  statuses: SalesStatusPoint[];
  hasAnyOrders: boolean;
};

/**
 * The comparison every KPI card shows. `percent` is null - never 0, never Infinity - when the
 * previous value is 0, because a percentage change from zero is undefined, not infinite; the UI
 * shows "no previous data" instead of inventing a number.
 */
export type SalesDelta = { current: number; previous: number; difference: number; percent: number | null };

export function salesDelta(current: number, previous: number): SalesDelta {
  const difference = current - previous;
  return { current, previous, difference, percent: previous === 0 ? null : (difference / Math.abs(previous)) * 100 };
}

/** AOV is undefined, not 0, when there were no orders - an average of nothing is not zero. */
export function averageOrderValue(orderValue: number, orderCount: number): number | null {
  return orderCount > 0 ? Math.round(orderValue / orderCount) : null;
}

/** Same rule: with no orders there is no cancellation rate to report. */
export function cancellationRate(cancelledCount: number, orderCount: number): number | null {
  return orderCount > 0 ? Math.round((cancelledCount / orderCount) * 1000) / 10 : null;
}

/**
 * Cancelled orders are EXCLUDED from every money sum and from `orderValue`, because a cancelled order
 * is not a sale. They are still counted in `orderCount` (so the order count reflects real demand) and
 * reported separately as `cancelledCount`, with the rate measured against the total. The database
 * query returns the two counts separately for exactly this reason.
 */
export type SalesAggregateRow = {
  orderValue: number; netOrderValue: number; vatTotal: number;
  orderCount: number; cancelledCount: number; unitsSold: number;
};

export function salesTotalsFrom(row: SalesAggregateRow): SalesTotals {
  const allOrders = row.orderCount + row.cancelledCount;
  return {
    orderValue: row.orderValue,
    netOrderValue: row.netOrderValue,
    vatTotal: row.vatTotal,
    orderCount: allOrders,
    unitsSold: row.unitsSold,
    averageOrderValue: averageOrderValue(row.orderValue, row.orderCount),
    cancelledCount: row.cancelledCount,
    cancellationRate: cancellationRate(row.cancelledCount, allOrders),
  };
}
