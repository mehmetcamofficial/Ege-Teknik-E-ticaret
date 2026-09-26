import { getDb } from "@/db";
import { analyticsEvents, orderItems, orders, products } from "@/db/schema";
import { and, between, count, countDistinct, desc, eq, gte, lt, ne, sql } from "drizzle-orm";
import { classifyDevice, isBotUserAgent, normalizeEventPath, salesTotalsFrom, type AnalyticsSummary, type DeviceCategory, type ResolvedRange, type SalesAggregateRow, type SalesSummary, type TrendGranularity } from "@/lib/analytics";

/**
 * Records one page/product view. Device and bot classification happen here, from the request's
 * own User-Agent header - never client-supplied, never persisted as a raw string (see
 * lib/analytics.ts's module doc for the full privacy model). Never throws for a stale/deleted
 * product id: the FK is real, but a race with a product being removed degrades this event to a
 * plain page view instead of failing outright, matching "analytics must never break the site".
 */
export async function recordEvent(input: { visitorId: string; path: string; productId?: string | null; referrerHost: string | null; userAgent: string | null }): Promise<{ isNewVisitor: boolean; isBot: boolean }> {
  const db = getDb();
  const device = classifyDevice(input.userAgent);
  const isBot = isBotUserAgent(input.userAgent);
  const [seen] = await db.select({ id: analyticsEvents.id }).from(analyticsEvents).where(eq(analyticsEvents.visitorId, input.visitorId)).limit(1);
  const isNewVisitor = !seen;
  const row = { id: crypto.randomUUID(), visitorId: input.visitorId, path: normalizeEventPath(input.path), productId: input.productId || null, referrerHost: input.referrerHost, device, isBot, isNewVisitor };
  try {
    await db.insert(analyticsEvents).values(row);
  } catch (error) {
    if (row.productId && pgErrorCode(error) === "23503") await db.insert(analyticsEvents).values({ ...row, productId: null });
    else throw error;
  }
  return { isNewVisitor, isBot };
}

/**
 * drizzle-orm wraps every driver error in its own DrizzleQueryError, which does not expose the
 * real Postgres error code as `.code` - the underlying `pg` error (and its `.code`) is nested at
 * `.cause`. Checking `error.code` directly always reads `undefined` and silently never matches,
 * which is exactly how the FK-violation retry above previously failed to ever fire (verified
 * against real PostgreSQL in Phase 6A.1 - a forged product id produced a 500 instead of the
 * intended graceful degradation until this was fixed).
 */
function pgErrorCode(error: unknown): string | undefined {
  return (error as { code?: string; cause?: { code?: string } })?.cause?.code ?? (error as { code?: string })?.code;
}

const notBot = eq(analyticsEvents.isBot, false);
const inRange = (r: ResolvedRange) => between(analyticsEvents.createdAt, r.start, r.end);

/**
 * Everything the admin dashboard shows, computed at read time from the raw event table -
 * see db/schema.ts's comment on analyticsEvents for why there is no separate rollup table yet.
 * Bot-classified events are excluded from every number except `botEventsExcluded` itself, which
 * exists purely so the admin can see that exclusion is happening, not to hide it.
 *
 * `totals.visitors` is all-time (never scoped to `range`) - the one headline number meant to
 * answer "how many people has the site ever had", shown alongside the range-scoped KPIs.
 * `totals.uniqueVisitors` and `totals.pageViews` are scoped to `range`, like every other number
 * here except `totals.visitors`.
 */
export async function loadAnalyticsSummary(range: ResolvedRange, now: Date): Promise<AnalyticsSummary> {
  const db = getDb();
  const base = and(notBot, inRange(range));

  const [[allTime], [rangeTotals], [botCount]] = await Promise.all([
    db.select({ n: countDistinct(analyticsEvents.visitorId) }).from(analyticsEvents).where(notBot),
    db.select({ visitors: countDistinct(analyticsEvents.visitorId), pageViews: count() }).from(analyticsEvents).where(base),
    db.select({ n: count() }).from(analyticsEvents).where(and(eq(analyticsEvents.isBot, true), inRange(range))),
  ]);

  // New vs returning: a visitor is "new" in this range if their all-time earliest event falls
  // inside it; "returning" if they have any earlier event still. Computed from real timestamps,
  // not merely trusting the per-event is_new_visitor flag, so it self-corrects even if that flag
  // was ever wrong for some row.
  const firstSeen = db.select({ visitorId: analyticsEvents.visitorId, firstSeen: sql<Date>`min(${analyticsEvents.createdAt})`.as("first_seen") }).from(analyticsEvents).where(notBot).groupBy(analyticsEvents.visitorId).as("first_seen_t");
  const activeInRange = db.selectDistinct({ visitorId: analyticsEvents.visitorId }).from(analyticsEvents).where(base).as("active_t");
  const [newVsReturning] = await db.select({
    newVisitors: sql<number>`count(*) filter (where ${firstSeen.firstSeen} >= ${range.start})::int`,
    returningVisitors: sql<number>`count(*) filter (where ${firstSeen.firstSeen} < ${range.start})::int`,
  }).from(activeInRange).innerJoin(firstSeen, eq(firstSeen.visitorId, activeInRange.visitorId));

  const [todayRow, weekRow, monthRow, yearRow] = await Promise.all(
    [0, 6, 29, 364].map((daysBack) => {
      const start = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
      return db.select({ n: countDistinct(analyticsEvents.visitorId) }).from(analyticsEvents).where(and(notBot, gte(analyticsEvents.createdAt, start), lt(analyticsEvents.createdAt, now)));
    }),
  );

  const dailyTrendRows = await db.select({
    day: sql<string>`to_char(${analyticsEvents.createdAt} at time zone 'UTC' + interval '3 hours', 'YYYY-MM-DD')`.as("day"),
    visitors: countDistinct(analyticsEvents.visitorId),
    pageViews: count(),
  }).from(analyticsEvents).where(base).groupBy(sql`1`).orderBy(sql`1`);

  const topPagesRows = await db.select({ path: analyticsEvents.path, views: count() }).from(analyticsEvents).where(base).groupBy(analyticsEvents.path).orderBy(desc(count())).limit(10);

  // Unpublished products are excluded from this ranking (a product decision, not a data-retention
  // one) - their historical events stay in analyticsEvents untouched and are never deleted; they
  // simply drop off THIS list once the product is no longer published.
  const topProductsRows = await db.select({ productId: analyticsEvents.productId, productName: products.name, views: count() })
    .from(analyticsEvents).innerJoin(products, eq(products.id, analyticsEvents.productId))
    .where(and(base, sql`${analyticsEvents.productId} is not null`, eq(products.status, "published"))).groupBy(analyticsEvents.productId, products.name).orderBy(desc(count())).limit(10);

  const deviceRows = await db.select({ device: analyticsEvents.device, n: count() }).from(analyticsEvents).where(base).groupBy(analyticsEvents.device);
  const devices: Record<DeviceCategory, number> = { mobile: 0, tablet: 0, desktop: 0 };
  for (const row of deviceRows) devices[row.device as DeviceCategory] = row.n;

  const referrerRows = await db.select({ host: analyticsEvents.referrerHost, n: count() }).from(analyticsEvents)
    .where(and(base, sql`${analyticsEvents.referrerHost} is not null`)).groupBy(analyticsEvents.referrerHost).orderBy(desc(count())).limit(10);

  return {
    range: { start: range.start.toISOString(), end: range.end.toISOString() },
    totals: {
      visitors: allTime?.n ?? 0,
      uniqueVisitors: rangeTotals?.visitors ?? 0,
      pageViews: rangeTotals?.pageViews ?? 0,
      newVisitors: newVsReturning?.newVisitors ?? 0,
      returningVisitors: newVsReturning?.returningVisitors ?? 0,
    },
    today: todayRow?.[0]?.n ?? 0,
    thisWeek: weekRow?.[0]?.n ?? 0,
    thisMonth: monthRow?.[0]?.n ?? 0,
    thisYear: yearRow?.[0]?.n ?? 0,
    dailyTrend: dailyTrendRows.map((r) => ({ date: r.day, visitors: r.visitors, pageViews: r.pageViews })),
    topPages: topPagesRows.map((r) => ({ path: r.path, views: r.views })),
    topProducts: topProductsRows.filter((r) => r.productId).map((r) => ({ productId: r.productId!, productName: r.productName, views: r.views })),
    devices,
    referrers: referrerRows.filter((r) => r.host).map((r) => ({ host: r.host!, visits: r.n })),
    botEventsExcluded: botCount?.n ?? 0,
  };
}

// ---- Sales analytics (Phase 3.3B) ---------------------------------------------------------------------
// Every query below is an aggregate over `orders` / `order_items`. There is deliberately NO
// `select *`, no order row and no customer column anywhere in this section: the browser receives
// counts and sums only, so drawing a sales chart never requires personal data to reach the client.
//
// Money semantics (see lib/analytics.ts): orderValue is what customers were ASKED to pay
// ("Sipariş Tutarı"), never collected cash. `orders.payment_status` is never read here - it is an
// operator's manual dropdown, and treating it as cash would be a fabrication. Cancelled orders are
// excluded from every money sum (a cancelled order is not a sale) but still counted in orderCount.

// Indexing (measured, Phase 3.3B.1, Preview / PostgreSQL 18): every query here filters `orders` by a
// created_at window. At the Preview volume the planner correctly picks sequential scans, and the
// existing (status, created_at) index is planner-usable for these query shapes, so no standalone
// orders(created_at) index is justified. Revisit only when meaningful production volume exists AND a
// measured query-performance problem appears (EXPLAIN (ANALYZE, BUFFERS) on real data, not a guess).

const inSalesRange = (r: ResolvedRange) => between(orders.createdAt, r.start, r.end);
const notCancelled = ne(orders.status, "cancelled");

/** Sums and counts over one window. Always exactly one row out, whatever the underlying volume. */
async function aggregateWindow(range: ResolvedRange): Promise<SalesAggregateRow> {
  const db = getDb();
  const [money] = await db
    .select({
      orderValue: sql<number>`coalesce(sum(${orders.total}) filter (where ${orders.status} <> 'cancelled'), 0)::bigint`,
      netOrderValue: sql<number>`coalesce(sum(${orders.subtotal}) filter (where ${orders.status} <> 'cancelled'), 0)::bigint`,
      vatTotal: sql<number>`coalesce(sum(${orders.vatTotal}) filter (where ${orders.status} <> 'cancelled'), 0)::bigint`,
      orderCount: sql<number>`count(*) filter (where ${orders.status} <> 'cancelled')::int`,
      cancelledCount: sql<number>`count(*) filter (where ${orders.status} = 'cancelled')::int`,
    })
    .from(orders)
    .where(inSalesRange(range));

  // Units sold lives on the order LINES, not on the order, so it needs a join. It obeys the same
  // range and the same cancelled-exclusion as the money sums, so the two can never disagree.
  const [units] = await db
    .select({ units: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int` })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(inSalesRange(range), notCancelled));

  return { ...money!, unitsSold: units?.units ?? 0 };
}

/**
 * Bucketing happens in SQL against Europe/Istanbul (fixed UTC+3, the same expression the traffic
 * analytics already uses) so an order lands in the Istanbul day it was actually created in,
 * whatever time zone the database session runs in. `date_trunc` is chosen from a closed union
 * below and is never built from request input.
 */
function bucketExpression(granularity: TrendGranularity) {
  const istanbul = sql`(${orders.createdAt} at time zone 'UTC' + interval '3 hours')`;
  if (granularity === "month") return sql`to_char(date_trunc('month', ${istanbul}), 'YYYY-MM')`;
  if (granularity === "week") return sql`to_char(date_trunc('week', ${istanbul}), 'YYYY-MM-DD')`;
  return sql`to_char(date_trunc('day', ${istanbul}), 'YYYY-MM-DD')`;
}

export async function loadSalesSummary(range: ResolvedRange, previousRange: ResolvedRange, granularity: TrendGranularity): Promise<SalesSummary> {
  const db = getDb();
  const bucket = bucketExpression(granularity);

  // Three independent reads, issued together. The two windows are separate queries on purpose:
  // folding them into one pass with a `CASE` bucket column would need a UNION over a second range
  // and buys nothing at this scale, while risking a silent over-count if the two diverge later.
  const [current, previous, trend, statuses] = await Promise.all([
    aggregateWindow(range),
    aggregateWindow(previousRange),
    db.select({
      bucket: sql<string>`${bucket}`.as("bucket"),
      orderValue: sql<number>`coalesce(sum(${orders.total}), 0)::bigint`,
      orderCount: sql<number>`count(*)::int`,
    })
      .from(orders)
      .where(and(inSalesRange(range), notCancelled))
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    db.select({
      status: orders.status,
      count: sql<number>`count(*)::int`,
      orderValue: sql<number>`coalesce(sum(${orders.total}), 0)::bigint`,
    })
      .from(orders)
      .where(inSalesRange(range))
      .groupBy(orders.status)
      .orderBy(desc(sql`count(*)`)),
  ]);

  return {
    range: { start: range.start.toISOString(), end: range.end.toISOString() },
    previousRange: { start: previousRange.start.toISOString(), end: previousRange.end.toISOString() },
    granularity,
    totals: salesTotalsFrom(current),
    previous: salesTotalsFrom(previous),
    trend: trend.map((r) => ({ bucket: r.bucket, orderValue: r.orderValue, orderCount: r.orderCount })),
    statuses: statuses.map((r) => ({ status: r.status, count: r.count, orderValue: r.orderValue })),
    hasAnyOrders: current.orderCount + current.cancelledCount > 0,
  };
}