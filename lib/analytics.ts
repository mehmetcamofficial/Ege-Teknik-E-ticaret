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
 * The comparison every KPI card shows. `percent` is null - never Infinity - when the previous value
 * is 0 and the current one is not, because a percentage change from zero is undefined, not infinite;
 * the UI shows "no previous data" instead of inventing a number. The same holds for 0 -> 0.
 */
export type SalesDelta = { current: number; previous: number; difference: number; percent: number | null };

export function salesDelta(current: number, previous: number): SalesDelta {
  const difference = current - previous;
  // Both values must be real numbers. A NaN/Infinity input (or a bigint string that slipped past the
  // data boundary) must never become a percentage on screen.
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return { current, previous, difference: 0, percent: null };
  // A previous value of 0 has no meaningful percentage (0 -> 0 and N -> from 0 alike): null, never Infinity.
  const percent = previous === 0 ? null : (difference / Math.abs(previous)) * 100;
  return { current, previous, difference, percent };
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


// ---- data boundary: driver values -> the documented API contract (Phase 3.3B.3) ----------------------
/**
 * node-postgres returns `bigint` (and `numeric`) aggregates as STRINGS - `sum(...)::bigint` arrives as
 * "1255800", not 1255800 - while `count(*)::int` arrives as a number. The documented API contract says
 * every monetary/count field is a number, so the conversion happens exactly once, here, at the server
 * boundary, and never in a React component. Anything that is not a finite, safe integer-or-decimal is
 * rejected loudly: an aggregate that cannot be represented exactly must fail the request, not be
 * rounded into a plausible-looking wrong figure.
 */
export type DbNumeric = string | number | bigint;

export function toSafeNumber(value: DbNumeric | null | undefined, field = "value"): number {
  if (value === null || value === undefined) throw new TypeError(`sales aggregate ${field} is missing`);
  const n = typeof value === "number" ? value : typeof value === "bigint" ? Number(value) : /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
  if (!Number.isFinite(n)) throw new TypeError(`sales aggregate ${field} is not a finite number`);
  if (Math.abs(n) > Number.MAX_SAFE_INTEGER) throw new RangeError(`sales aggregate ${field} exceeds the safe integer range`);
  return n;
}

/** The raw shape the aggregate queries return from the driver. */
export type RawSalesAggregate = {
  orderValue: DbNumeric; netOrderValue: DbNumeric; vatTotal: DbNumeric;
  orderCount: DbNumeric; cancelledCount: DbNumeric; unitsSold: DbNumeric;
};
export type RawTrendRow = { bucket: string; orderValue: DbNumeric; orderCount: DbNumeric };
export type RawStatusRow = { status: string; count: DbNumeric; orderValue: DbNumeric };

export function normalizeSalesAggregate(raw: RawSalesAggregate): SalesAggregateRow {
  return {
    orderValue: toSafeNumber(raw.orderValue, "orderValue"),
    netOrderValue: toSafeNumber(raw.netOrderValue, "netOrderValue"),
    vatTotal: toSafeNumber(raw.vatTotal, "vatTotal"),
    orderCount: toSafeNumber(raw.orderCount, "orderCount"),
    cancelledCount: toSafeNumber(raw.cancelledCount, "cancelledCount"),
    unitsSold: toSafeNumber(raw.unitsSold, "unitsSold"),
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const utcDayKey = (d: Date) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

/**
 * Every bucket key inside `range`, in Europe/Istanbul time (fixed UTC+3, the same rule the SQL uses to
 * bucket), formatted exactly like the SQL keys: `YYYY-MM-DD` for day, the Monday `YYYY-MM-DD` for week
 * (date_trunc('week') is ISO Monday), `YYYY-MM` for month. Bounded by the 400-day range cap.
 */
export function trendBucketKeys(range: ResolvedRange, granularity: TrendGranularity): string[] {
  const start = new Date(range.start.getTime() + TR_OFFSET_MS);
  const end = new Date(range.end.getTime() + TR_OFFSET_MS);
  const keys: string[] = [];
  if (granularity === "month") {
    let y = start.getUTCFullYear(), m = start.getUTCMonth();
    const ey = end.getUTCFullYear(), em = end.getUTCMonth();
    while ((y < ey || (y === ey && m <= em)) && keys.length < 100) {
      keys.push(`${y}-${pad2(m + 1)}`);
      if (++m > 11) { m = 0; y++; }
    }
    return keys;
  }
  const step = granularity === "week" ? 7 : 1;
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  if (granularity === "week") cursor = addDays(cursor, -((cursor.getUTCDay() + 6) % 7));
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  while (cursor.getTime() <= last && keys.length < 500) { keys.push(utcDayKey(cursor)); cursor = addDays(cursor, step); }
  return keys;
}

/**
 * Fills the buckets that had no orders with explicit zeros, so a chart shows the quiet days as quiet
 * instead of drawing a line between two isolated observations as if activity had been continuous.
 * Buckets the database returned are kept as-is (and any that fall outside the generated grid are kept
 * too, never silently dropped).
 */
export function fillTrendBuckets(rows: SalesTrendPoint[], range: ResolvedRange, granularity: TrendGranularity): SalesTrendPoint[] {
  const byBucket = new Map(rows.map((r) => [r.bucket, r]));
  const filled = trendBucketKeys(range, granularity).map((bucket) => byBucket.get(bucket) ?? { bucket, orderValue: 0, orderCount: 0 });
  const known = new Set(filled.map((p) => p.bucket));
  return [...filled, ...rows.filter((r) => !known.has(r.bucket))].sort((a, b) => (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0));
}

export type BuildSalesSummaryInput = {
  range: ResolvedRange; previousRange: ResolvedRange; granularity: TrendGranularity;
  current: RawSalesAggregate; previous: RawSalesAggregate; trend: RawTrendRow[]; statuses: RawStatusRow[];
};

/** The one place raw driver rows become the public SalesSummary: numbers only, buckets filled. */
export function buildSalesSummary(input: BuildSalesSummaryInput): SalesSummary {
  const current = normalizeSalesAggregate(input.current);
  const trend = input.trend.map((r) => ({ bucket: r.bucket, orderValue: toSafeNumber(r.orderValue, "trend.orderValue"), orderCount: toSafeNumber(r.orderCount, "trend.orderCount") }));
  return {
    range: { start: input.range.start.toISOString(), end: input.range.end.toISOString() },
    previousRange: { start: input.previousRange.start.toISOString(), end: input.previousRange.end.toISOString() },
    granularity: input.granularity,
    totals: salesTotalsFrom(current),
    previous: salesTotalsFrom(normalizeSalesAggregate(input.previous)),
    trend: fillTrendBuckets(trend, input.range, input.granularity),
    statuses: input.statuses.map((r) => ({ status: r.status, count: toSafeNumber(r.count, "status.count"), orderValue: toSafeNumber(r.orderValue, "status.orderValue") })),
    hasAnyOrders: current.orderCount + current.cancelledCount > 0,
  };
}

const MONTHS_TR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const MONTHS_TR_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

/**
 * Human labels for a bucket key: `short` for the axis, `full` for the tooltip/table. Formatted from the
 * key itself (already an Istanbul calendar date), so it can never shift a day with the viewer's zone.
 */
export function formatTrendBucket(bucket: string, granularity: TrendGranularity): { short: string; full: string } {
  const [y, m, d] = bucket.split("-").map(Number) as [number, number, number | undefined];
  if (granularity === "month") return { short: `${MONTHS_TR_SHORT[m - 1]} ${y}`, full: `${MONTHS_TR[m - 1]} ${y}` };
  const day = `${d} ${MONTHS_TR_SHORT[m - 1]}`;
  if (granularity === "week") {
    const end = addDays(new Date(Date.UTC(y, m - 1, d)), 6);
    return { short: day, full: `${day} – ${end.getUTCDate()} ${MONTHS_TR_SHORT[end.getUTCMonth()]} ${end.getUTCFullYear()}` };
  }
  return { short: day, full: `${d} ${MONTHS_TR[m - 1]} ${y}` };
}

/**
 * Axis/KPI money in plain Turkish: "300 bin", "1,2 milyon" instead of the compact "300 B" / "1,2 Mn"
 * that Intl produces for tr-TR, which a reader has to decode.
 */
export function formatTryAxis(value: number): string {
  const abs = Math.abs(value);
  const f = (n: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(n);
  if (abs >= 1_000_000) return `₺${f(value / 1_000_000)} milyon`;
  if (abs >= 1_000) return `₺${f(value / 1_000)} bin`;
  return `₺${f(value)}`;
}

/** Turkish, user-facing text for the range resolver's internal validation codes. Unknown codes fail closed to a generic message. */
export function analyticsRangeErrorMessage(error: string): string {
  switch (error) {
    case "range too large": return "Özel tarih aralığı en fazla 400 gün olabilir.";
    case "custom range requires from and to": return "Özel aralık için başlangıç ve bitiş tarihi seçin.";
    case "invalid date": return "Geçersiz tarih. Lütfen tarihleri kontrol edin.";
    case "from must not be after to": return "Başlangıç tarihi bitiş tarihinden sonra olamaz.";
    default: return "Geçersiz tarih aralığı.";
  }
}

const DATE_ONLY_QUERY = /^\d{4}-\d{2}-\d{2}$/;
/**
 * The query string the Analytics page initialises from a URL. Only a supported preset, or a custom
 * range of two valid `YYYY-MM-DD` dates that the same resolver (and 400-day cap) accepts, survives;
 * anything else falls back to the default `range=7d`. It never throws, and it rebuilds the string from
 * validated parts rather than echoing user input.
 */
export function sanitizeAnalyticsQuery(input: { range?: unknown; from?: unknown; to?: unknown }, now: Date): string {
  const first = (v: unknown) => (typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : undefined);
  const range = first(input.range);
  if (!range || !(dateRangePresets as readonly string[]).includes(range)) return "range=7d";
  if (range !== "custom") return `range=${range}`;
  const from = first(input.from), to = first(input.to);
  if (!from || !to || !DATE_ONLY_QUERY.test(from) || !DATE_ONLY_QUERY.test(to)) return "range=7d";
  const current = resolveDateRange("custom", now, from, to);
  const previous = resolvePreviousRange("custom", now, from, to);
  return current.ok && previous.ok ? `range=custom&from=${from}&to=${to}` : "range=7d";
}


/**
 * The traffic API returns only the days that had visits. Charting those alone would butt two isolated
 * days together as if the days between them had been busy, so the quiet days are filled with explicit
 * zeros here (same Istanbul day keys the SQL uses), exactly as the sales trend is.
 */
export function fillDailyVisitors(rows: AnalyticsSummary["dailyTrend"], range: ResolvedRange): AnalyticsSummary["dailyTrend"] {
  const byDay = new Map(rows.map((r) => [r.date, r]));
  const filled = trendBucketKeys(range, "day").map((date) => byDay.get(date) ?? { date, visitors: 0, pageViews: 0 });
  const known = new Set(filled.map((r) => r.date));
  return [...filled, ...rows.filter((r) => !known.has(r.date))].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
