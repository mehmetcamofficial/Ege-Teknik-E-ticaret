import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  analyticsRangeErrorMessage, averageOrderValue, buildSalesSummary, cancellationRate, dateRangePresets, fillTrendBuckets,
  formatTrendBucket, formatTryAxis, resolveDateRange, resolvePreviousRange, salesDelta, salesTotalsFrom,
  sanitizeAnalyticsQuery, toSafeNumber, trendBucketKeys, trendGranularityFor, type RawSalesAggregate,
} from "../lib/analytics.ts";

/**
 * Phase 3.3B: the date-range foundation (90d, previous-period comparison, trend granularity) and the
 * sales aggregation semantics - all pure, so every rule below is reproducible without a database.
 */

// 2026-06-04 15:00 Istanbul == 12:00 UTC. Istanbul is a fixed UTC+3, so there is no DST ambiguity.
const NOON_UTC = new Date("2026-06-04T12:00:00.000Z");
const day = 24 * 60 * 60 * 1000;

function resolved(preset: (typeof dateRangePresets)[number], now: Date = NOON_UTC) {
  const r = resolveDateRange(preset, now);
  assert.equal(r.ok, true, `${preset} must resolve`);
  if (!r.ok) throw new Error("unreachable");
  return r.range;
}

// ---- 90d -----------------------------------------------------------------------------------------
test("90d covers exactly 90 Istanbul calendar days and ends at now", () => {
  const range = resolved("90d");
  assert.equal(range.start.toISOString(), "2026-03-06T21:00:00.000Z"); // 2026-03-06 00:00 Istanbul
  assert.equal(range.end.getTime(), NOON_UTC.getTime());
});
test("90d is monotonically wider than 30d and 7d", () => {
  const span = (p: "7d" | "30d" | "90d") => { const r = resolved(p); return r.end.getTime() - r.start.getTime(); };
  assert.ok(span("7d") < span("30d") && span("30d") < span("90d"));
});
test("90d is offered alongside the existing presets, not in place of any of them", () => {
  for (const p of ["today", "7d", "30d", "90d", "month", "year", "custom"]) assert.ok(dateRangePresets.includes(p as never), p);
});

// ---- previous period ------------------------------------------------------------------------------
test("a rolling preset compares against the SAME-LENGTH window ending exactly where the current one begins", () => {
  for (const preset of ["7d", "30d", "90d"] as const) {
    const current = resolved(preset);
    const previous = resolvePreviousRange(preset, NOON_UTC);
    assert.equal(previous.ok, true);
    if (!previous.ok) continue;
    assert.equal(previous.range.end.getTime(), current.start.getTime(), `${preset}: the two windows must abut exactly`);
    assert.equal(previous.range.start.getTime(), current.start.getTime() - (current.end.getTime() - current.start.getTime()), `${preset}: same length`);
  }
});
test("the comparison window never reaches into the future and never overlaps the current one", () => {
  for (const preset of ["today", "7d", "30d", "90d", "month", "year"] as const) {
    const current = resolved(preset);
    const previous = resolvePreviousRange(preset, NOON_UTC);
    assert.equal(previous.ok, true);

test("'month' compares against the PREVIOUS CALENDAR month, not the last 30 days", () => {
  const current = resolved("month");
  const previous = resolvePreviousRange("month", NOON_UTC);
  assert.equal(previous.ok, true);
  if (!previous.ok) return;
  assert.equal(previous.range.start.toISOString(), "2026-04-30T21:00:00.000Z"); // 2026-05-01 00:00 Istanbul
  assert.equal(previous.range.end.getTime(), current.start.getTime());
  // The decisive difference: this is a CALENDAR month (May = 31 days), not a 30-day rolling window.
  assert.equal(previous.range.end.getTime() - previous.range.start.getTime(), 31 * day);
});
test("'year' compares against the previous calendar year", () => {
  const previous = resolvePreviousRange("year", NOON_UTC);
  assert.equal(previous.ok, true);
  if (!previous.ok) return;
  assert.equal(previous.range.start.toISOString(), "2024-12-31T21:00:00.000Z"); // 2025-01-01 00:00 Istanbul
  assert.equal(previous.range.end.getTime(), resolved("year").start.getTime());
});
test("'today' compares against the elapsed-so-far window of the current day, not a whole previous day", () => {
  const current = resolved("today");
  const previous = resolvePreviousRange("today", NOON_UTC);
  assert.equal(previous.ok, true);
  if (!previous.ok) return;
  assert.equal(previous.range.end.getTime() - previous.range.start.getTime(), current.end.getTime() - current.start.getTime());
  assert.equal(previous.range.end.getTime(), current.start.getTime());
});
test("a custom range compares against the same-length window immediately before it", () => {
  const current = resolveDateRange("custom", NOON_UTC, "2026-05-01", "2026-05-10");
  const previous = resolvePreviousRange("custom", NOON_UTC, "2026-05-01", "2026-05-10");
  assert.equal(current.ok, true); assert.equal(previous.ok, true);
  if (!current.ok || !previous.ok) return;
  assert.equal(previous.range.end.getTime(), current.range.start.getTime());
  assert.equal(previous.range.end.getTime() - previous.range.start.getTime(), current.range.end.getTime() - current.range.start.getTime());
});
test("a comparison is only produced for a VALID current range - an invalid one fails the same way", () => {
  assert.equal(resolvePreviousRange("custom", NOON_UTC).ok, false, "missing from/to");
  assert.equal(resolvePreviousRange("custom", NOON_UTC, "2026-05-10", "2026-05-01").ok, false, "from after to");
  assert.equal(resolvePreviousRange("custom", NOON_UTC, "not-a-date", "2026-05-10").ok, false, "unparseable");
  assert.equal(resolvePreviousRange("custom", NOON_UTC, "2000-01-01", "2026-01-01").ok, false, "over the 400-day cap");
});
test("a custom range whose end is in the future is capped at now, and so is its comparison", () => {
  const current = resolveDateRange("custom", NOON_UTC, "2026-06-01", "2026-07-01");
  const previous = resolvePreviousRange("custom", NOON_UTC, "2026-06-01", "2026-07-01");
  assert.equal(current.ok, true); assert.equal(previous.ok, true);
  if (!current.ok || !previous.ok) return;
  assert.equal(current.range.end.getTime(), NOON_UTC.getTime());
  assert.ok(previous.range.end.getTime() <= NOON_UTC.getTime());
});

// ---- trend granularity ----------------------------------------------------------------------------
test("granularity is chosen from the range length so a chart never gets an unreadable number of points", () => {
  const span = (ms: number) => trendGranularityFor({ start: new Date(0), end: new Date(ms) });
  assert.equal(span(day), "day");

// ---- sales deltas ---------------------------------------------------------------------------------
test("a percentage change from a previous value of ZERO is undefined, not 0 and not Infinity", () => {
  const d = salesDelta(500, 0);
  assert.equal(d.percent, null, "the UI must show 'no previous data' rather than a fabricated percentage");
  assert.equal(d.current, 500);
  assert.equal(d.previous, 0);
  assert.equal(d.difference, 500);
});
test("an unchanged metric reads differently from 'no previous data'", () => {
  assert.equal(salesDelta(0, 0).percent, null, "0 -> 0 has no meaningful percentage either");
  assert.equal(salesDelta(0, 0).difference, 0);
  assert.equal(salesDelta(750, 750).percent, 0, "a real 0% change must be reported as 0, not hidden");
  assert.equal(salesDelta(750, 750).difference, 0);
});
test("growth and decline are signed correctly, including against a negative previous value", () => {
  assert.equal(salesDelta(150, 100).percent, 50);
  assert.equal(salesDelta(50, 100).percent, -50);
  assert.equal(salesDelta(150, 100).difference, 50);
  assert.equal(salesDelta(50, 100).difference, -50);
  assert.equal(salesDelta(10, -10).percent, 200, "magnitude uses the absolute previous value");
});

// ---- sales totals semantics ------------------------------------------------------------------------
test("cancelled orders are excluded from every money sum but still counted in orderCount", () => {
  const totals = salesTotalsFrom({ orderValue: 100_000, netOrderValue: 83_333, vatTotal: 16_667, orderCount: 3, cancelledCount: 1, unitsSold: 5 });
  assert.equal(totals.orderValue, 100_000, "a cancelled order is not a sale, so it never enters the money sums");
  assert.equal(totals.orderCount, 4, "but demand is real: the count includes it");
  assert.equal(totals.cancelledCount, 1);
  assert.equal(totals.unitsSold, 5);
});
test("AOV divides the money total by the non-cancelled order count only", () => {
  const totals = salesTotalsFrom({ orderValue: 90_000, netOrderValue: 75_000, vatTotal: 15_000, orderCount: 3, cancelledCount: 3, unitsSold: 4 });
  assert.equal(totals.orderCount, 6);
  assert.equal(totals.averageOrderValue, 30_000, "90.000 over 3 real orders, not over all 6");
});
test("with no orders, AOV and the cancellation rate are null - an average of nothing is not zero", () => {
  const totals = salesTotalsFrom({ orderValue: 0, netOrderValue: 0, vatTotal: 0, orderCount: 0, cancelledCount: 0, unitsSold: 0 });
  assert.equal(totals.averageOrderValue, null);
  assert.equal(totals.cancellationRate, null);
  assert.equal(totals.orderCount, 0);
});
test("the cancellation rate is a percentage of ALL orders, rounded to one decimal", () => {
  assert.equal(cancellationRate(1, 3), 33.3);
  assert.equal(cancellationRate(1, 2), 50);
  assert.equal(cancellationRate(0, 5), 0);
  assert.equal(averageOrderValue(10_000, 3), 3_333);
});
test("subtotal + VAT always reconstructs the order value, so the three figures can never disagree", () => {
  const totals = salesTotalsFrom({ orderValue: 120_000, netOrderValue: 100_000, vatTotal: 20_000, orderCount: 2, cancelledCount: 0, unitsSold: 2 });
  assert.equal(totals.netOrderValue + totals.vatTotal, totals.orderValue);
});
  assert.equal(span(30 * day), "day");
  assert.equal(span(45 * day), "day");
  assert.equal(span(46 * day), "week");
  assert.equal(span(90 * day), "week");
  assert.equal(span(200 * day), "week");
  assert.equal(span(201 * day), "month");
  assert.equal(span(365 * day), "month");
});
test("the real presets bucket sensibly: short windows daily, 90d weekly, a long year monthly", () => {
  assert.equal(trendGranularityFor(resolved("7d")), "day");
  assert.equal(trendGranularityFor(resolved("30d")), "day");
  assert.equal(trendGranularityFor(resolved("90d")), "week");
  // "Bu yıl" in mid-June spans ~155 days, so it is still weekly (~22 points). Only once the window
  // passes 200 days - i.e. from July onwards - does it switch to monthly. This is deliberate: the
  // bucket follows the ACTUAL window length, so the point count stays readable all year instead of
  // jumping granularity on a calendar boundary.
  assert.equal(trendGranularityFor(resolved("year")), "week");
  // Late in the year the same preset genuinely becomes monthly.
  const lateInYear = resolved("year", new Date("2026-12-20T12:00:00.000Z"));
  assert.equal(trendGranularityFor(lateInYear), "month");
});
    if (!previous.ok) continue;
    assert.ok(previous.range.end.getTime() <= current.start.getTime(), `${preset}: previous must end at or before current starts`);
    assert.ok(previous.range.end.getTime() <= NOON_UTC.getTime(), `${preset}: previous must not be in the future`);
    assert.ok(previous.range.start.getTime() < previous.range.end.getTime(), `${preset}: previous must be a real, non-empty window`);
  }
});

// ---- terminology ---------------------------------------------------------------------------------
// Scoped to the Sales Analytics UI on purpose: no payment provider is integrated, so `orders.total` is
// what customers were ASKED to pay, not money collected. A future Finance/PayTR screen will legitimately
// say Tahsilat/Gelir; this guard must not become a repository-wide wording rule.
test("sales analytics presents order value as Sipariş Tutarı, never Ciro / Tahsilat / Gelir", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../app/admin/analytics-sales.tsx", import.meta.url), "utf8");
  // Comments here explain WHY those words are avoided, so only shipped code and UI strings are checked.
  const shipped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.ok(shipped.includes("Sipariş Tutarı"), "the order-value metric must be labelled Sipariş Tutarı");
  assert.doesNotMatch(shipped, /ciro|tahsilat|gelir/i, "order value must not be presented as Ciro, Tahsilat or Gelir");
});


// =====================================================================================================
// Phase 3.3B.3 - Analytics V2.1: regression coverage for every finding of the authenticated visual QA.
// =====================================================================================================
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const salesUi = strip(readFileSync(new URL("../app/admin/analytics-sales.tsx", import.meta.url), "utf8"));
const v2Ui = strip(readFileSync(new URL("../app/admin/analytics-v2.tsx", import.meta.url), "utf8"));
const toolbarUi = readFileSync(new URL("../app/admin/analytics-range-toolbar.tsx", import.meta.url), "utf8");
const pageSrc = readFileSync(new URL("../app/admin/(panel)/analytics/page.tsx", import.meta.url), "utf8");
const dbSrc = readFileSync(new URL("../lib/analytics-db.ts", import.meta.url), "utf8");
const primitivesSrc = readFileSync(new URL("../components/admin/analytics-primitives.tsx", import.meta.url), "utf8");

// The values node-postgres really returns: `sum(...)::bigint` arrives as a STRING, `count(*)::int` as a number.
const driverRow = (over: Partial<Record<keyof RawSalesAggregate, string | number>> = {}): RawSalesAggregate => ({
  orderValue: "1255800", netOrderValue: "1046505", vatTotal: "209295", orderCount: 16, cancelledCount: 0, unitsSold: 17, ...over,
});
const emptyDriverRow = (): RawSalesAggregate => driverRow({ orderValue: "0", netOrderValue: "0", vatTotal: "0", orderCount: 0, cancelledCount: 0, unitsSold: 0 });
const ISTANBUL_SEP_22_TO_24 = { start: new Date("2026-09-21T21:00:00.000Z"), end: new Date("2026-09-24T14:00:00.000Z") };

function summaryFromDriver(over: { current?: RawSalesAggregate; previous?: RawSalesAggregate } = {}) {
  return buildSalesSummary({
    range: ISTANBUL_SEP_22_TO_24, previousRange: { start: new Date("2026-09-18T21:00:00.000Z"), end: ISTANBUL_SEP_22_TO_24.start },
    granularity: "day", current: over.current ?? driverRow(), previous: over.previous ?? emptyDriverRow(),
    trend: [{ bucket: "2026-09-22", orderValue: "58400", orderCount: 1 }, { bucket: "2026-09-24", orderValue: "1197400", orderCount: 15 }],
    statuses: [{ status: "pending_payment", count: 16, orderValue: "1255800" }],
  });
}

// ---- P1: the numeric API contract ----------------------------------------------------------------
test("bigint strings from the driver reach the API JSON as numbers, at every monetary field", () => {
  const wire = JSON.parse(JSON.stringify(summaryFromDriver())) as ReturnType<typeof summaryFromDriver>; // what the browser receives
  for (const t of [wire.totals, wire.previous]) {
    for (const k of ["orderValue", "netOrderValue", "vatTotal", "orderCount", "unitsSold", "cancelledCount"] as const) assert.equal(typeof t[k], "number", `totals.${k}`);
  }
  assert.equal(wire.totals.orderValue, 1255800);
  assert.equal(wire.totals.netOrderValue, 1046505);
  assert.equal(wire.totals.vatTotal, 209295);
  assert.equal(wire.previous.orderValue, 0);
  assert.equal(wire.totals.averageOrderValue, 78488);
  for (const p of wire.trend) { assert.equal(typeof p.orderValue, "number"); assert.equal(typeof p.orderCount, "number"); }
  for (const st of wire.statuses) { assert.equal(typeof st.orderValue, "number"); assert.equal(typeof st.count, "number"); }
});
test("toSafeNumber accepts the driver's numeric forms and refuses anything that is not exactly representable", () => {
  assert.equal(toSafeNumber("1255800"), 1255800);
  assert.equal(toSafeNumber("0"), 0);
  assert.equal(toSafeNumber(7), 7);
  assert.equal(toSafeNumber(BigInt(12)), 12);
  assert.equal(toSafeNumber("-5"), -5);
  for (const bad of ["abc", "", "1e9", "Infinity", "NaN", "12px"]) assert.throws(() => toSafeNumber(bad), TypeError, `"${bad}"`);
  assert.throws(() => toSafeNumber(null), TypeError);
  assert.throws(() => toSafeNumber(Number.NaN), TypeError);
  assert.throws(() => toSafeNumber("9007199254740993"), RangeError, "an integer above 2^53 must fail rather than be rounded");
});
test("a corrupt aggregate fails the whole summary instead of leaking a non-finite value to a chart", () => {
  assert.throws(() => summaryFromDriver({ current: driverRow({ orderValue: "not-a-number" }) }), TypeError);
});
test("nothing the summary hands to the UI or a chart is ever NaN or Infinity", () => {
  const finite = (v: unknown): void => {
    if (typeof v === "number") assert.ok(Number.isFinite(v), `non-finite number ${v}`);
    else if (Array.isArray(v)) v.forEach(finite);
    else if (v && typeof v === "object") Object.values(v).forEach(finite);
  };
  finite(summaryFromDriver());
  finite(summaryFromDriver({ current: emptyDriverRow() }));
});

test("comparison: current > 0 against previous 0 is unavailable (null), never Infinity", () => {
  const d = salesDelta(1255800, 0);
  assert.equal(d.percent, null);
  assert.notEqual(d.percent, Number.POSITIVE_INFINITY);
});
test("comparison: 0 -> 0 has no percentage (null) and no difference - the UI says both periods are empty", () => {
  const d = salesDelta(0, 0);
  assert.equal(d.percent, null);
  assert.equal(d.difference, 0);
  assert.match(salesUi, /İki dönemde de kayıt yok/);
});
test("comparison: ordinary increases and decreases", () => {
  assert.equal(salesDelta(150, 100).percent, 50);
  assert.equal(salesDelta(50, 100).percent, -50);
  assert.equal(salesDelta(0, 100).percent, -100);
});
test("comparison: a value that is not a finite number (e.g. an un-normalised bigint string) can never become Infinity/NaN", () => {
  for (const [cur, prev] of [["1255800", "0"], [Number.NaN, 5], [5, Number.POSITIVE_INFINITY]] as const) {
    const d = salesDelta(cur as never, prev as never);
    assert.equal(d.percent, null);
    assert.ok(Number.isFinite(d.difference));
  }
});

test("no Infinity / NaN / Number(...) coercion anywhere in the shipped Sales Analytics UI", () => {
  for (const [name, src] of [["analytics-sales", salesUi], ["analytics-v2", v2Ui]] as const) {
    assert.doesNotMatch(src, /\bInfinity\b|\bNaN\b/, `${name} must not mention Infinity/NaN`);
    assert.doesNotMatch(src, /\bNumber\(|\bparseFloat\(|\bparseInt\(/, `${name} must not paper over the API contract with a client-side conversion`);
  }
});
test("the database layer routes every raw row through buildSalesSummary and never returns raw aggregates itself", () => {
  const load = dbSrc.slice(dbSrc.indexOf("export async function loadSalesSummary"));
  assert.match(load, /return buildSalesSummary\(/);
  assert.doesNotMatch(load, /salesTotalsFrom\(/, "totals must be built from normalised numbers inside buildSalesSummary");
  assert.match(dbSrc, /async function aggregateWindow\(range: ResolvedRange\): Promise<RawSalesAggregate>/);
});

// ---- trend: missing buckets are explicit zeros ---------------------------------------------------
test("a day with no orders inside the range is filled with an explicit zero, not skipped", () => {
  const trend = summaryFromDriver().trend;
  assert.deepEqual(trend.map((p) => p.bucket), ["2026-09-22", "2026-09-23", "2026-09-24"]);
  assert.deepEqual(trend[1], { bucket: "2026-09-23", orderValue: 0, orderCount: 0 });
  assert.equal(trend[0]!.orderValue, 58400);
  assert.equal(trend[2]!.orderCount, 15);
});
test("bucket keys follow Istanbul calendar days: 00:30 Istanbul on 1 Oct is 1 Oct, not 30 Sep", () => {
  const keys = trendBucketKeys({ start: new Date("2026-09-30T21:30:00.000Z"), end: new Date("2026-10-02T10:00:00.000Z") }, "day");
  assert.deepEqual(keys, ["2026-10-01", "2026-10-02"]);
});
test("weekly buckets are ISO Mondays, matching date_trunc('week'), including a range that starts mid-week", () => {
  const keys = trendBucketKeys({ start: new Date("2026-09-21T21:00:00.000Z") /* Tue 22 Sep */, end: new Date("2026-10-06T12:00:00.000Z") }, "week");
  assert.deepEqual(keys, ["2026-09-21", "2026-09-28", "2026-10-05"]);
});
test("monthly buckets cover every calendar month in the range across a year boundary", () => {
  const keys = trendBucketKeys({ start: new Date("2025-11-15T00:00:00.000Z"), end: new Date("2026-02-10T00:00:00.000Z") }, "month");
  assert.deepEqual(keys, ["2025-11", "2025-12", "2026-01", "2026-02"]);
});
test("filling never drops or duplicates a bucket the database returned, and a quiet range is all zeros", () => {
  const rows = [{ bucket: "2026-09-22", orderValue: 5, orderCount: 1 }];
  const filled = fillTrendBuckets(rows, ISTANBUL_SEP_22_TO_24, "day");
  assert.equal(filled.filter((p) => p.bucket === "2026-09-22").length, 1);
  assert.equal(fillTrendBuckets([], ISTANBUL_SEP_22_TO_24, "day").every((p) => p.orderValue === 0 && p.orderCount === 0), true);
  assert.equal(fillTrendBuckets([{ bucket: "2030-01-01", orderValue: 1, orderCount: 1 }], ISTANBUL_SEP_22_TO_24, "day").some((p) => p.bucket === "2030-01-01"), true);
});
test("the point count stays bounded for every real preset", () => {
  for (const preset of dateRangePresets.filter((x) => x !== "custom")) {
    const r = resolveDateRange(preset, NOON_UTC);
    if (!r.ok) throw new Error("unreachable");
    assert.ok(trendBucketKeys(r.range, trendGranularityFor(r.range)).length <= 60, `${preset} must stay chart-readable`);
  }
});
test("axis and tooltip labels are plain Turkish, not the ambiguous compact 'B' / 'Mn'", () => {
  assert.equal(formatTryAxis(300_000), "₺300 bin");
  assert.equal(formatTryAxis(1_200_000), "₺1,2 milyon");
  assert.equal(formatTryAxis(950), "₺950");
  assert.equal(formatTryAxis(0), "₺0");
  assert.doesNotMatch(formatTryAxis(1_200_000), /\bMn\b|\bB\b/);
  assert.deepEqual(formatTrendBucket("2026-09-22", "day"), { short: "22 Eyl", full: "22 Eylül 2026" });
  assert.equal(formatTrendBucket("2026-09-28", "week").full, "28 Eyl – 4 Eki 2026");
  assert.deepEqual(formatTrendBucket("2026-09", "month"), { short: "Eyl 2026", full: "Eylül 2026" });
});
test("the trend renders ONE primary money series with an exact tooltip, no competing dual axis", () => {
  assert.equal((salesUi.match(/<YAxis\b/g) ?? []).length, 2, "one Y axis per chart (trend + status), not a second value axis on the trend");
  assert.match(salesUi, /<Bar dataKey="orderValue"/);
  assert.doesNotMatch(salesUi, /dataKey="orderCount"/, "order count belongs in the tooltip/table, not a second plotted series");
  assert.match(salesUi, /Sipariş Tutarı/);
  assert.match(salesUi, /Sipariş Sayısı/);
  assert.match(salesUi, /row\.full/, "the tooltip must show the exact date");
  assert.doesNotMatch(salesUi, /isAnimationActive=\{true\}/);
});

// ---- status distribution: adaptive ---------------------------------------------------------------
test("a single status is a compact summary card, not a giant bar, and is not repeated as a second progress bar", () => {
  assert.match(salesUi, /statuses\.length === 1/);
  assert.match(salesUi, /sipariş<\/span>/, "the compact card states the order count");
  assert.match(salesUi, /Sipariş Tutarı<\/p>/, "and the order value with the correct wording");
  assert.doesNotMatch(salesUi, /BarRow/, "the same distribution must not be drawn a second time as progress bars");
});
test("multiple statuses use the comparative bar chart and both cases keep the accessible table", () => {
  assert.match(salesUi, /layout="vertical"/);
  assert.equal((salesUi.match(/Tablo olarak gör/g) ?? []).length, 2, "trend and status each keep a real table");
});
test("statuses are shown with Turkish admin labels, and an unknown value is shown verbatim rather than guessed", () => {
  assert.match(salesUi, /orderStatusLabel\[status\] \?\? status/);
});
test("the KPI set is complete and the not-collected-payment notice is kept", () => {
  for (const label of ["Sipariş Tutarı", "Sipariş Sayısı", "Satılan Ürün Adedi", "Ortalama Sipariş Tutarı", "İptal Oranı"]) assert.ok(salesUi.includes(`label="${label}"`), label);
  assert.match(salesUi, /tahsil edilen para anlamına gelmez/);
});

// ---- URL-aware range -----------------------------------------------------------------------------
const NOW = new Date("2026-09-26T12:00:00.000Z");
test("supported presets initialise from the URL", () => {
  for (const preset of ["today", "7d", "30d", "90d", "month", "year"]) assert.equal(sanitizeAnalyticsQuery({ range: preset }, NOW), `range=${preset}`);
});
test("a valid custom range is preserved, and rebuilt from validated parts", () => {
  assert.equal(sanitizeAnalyticsQuery({ range: "custom", from: "2026-09-01", to: "2026-09-25" }, NOW), "range=custom&from=2026-09-01&to=2026-09-25");
});
test("invalid URL state falls back to the default without throwing", () => {
  const bad: { range?: unknown; from?: unknown; to?: unknown }[] = [
    {}, { range: "bogus" }, { range: 5 }, { range: ["30d", "7d"], from: "x" }, { range: "custom" }, { range: "custom", from: "2026-09-01" },
    { range: "custom", from: "2026-13-45", to: "2026-09-25" }, { range: "custom", from: "yesterday", to: "today" },
    { range: "custom", from: "2026-09-25", to: "2026-09-01" }, { range: "custom", from: "2020-01-01", to: "2026-09-25" },
    { range: "custom", from: "2026-09-01&range=30d", to: "2026-09-25" }, { range: "<script>", from: {}, to: [] },
  ];
  for (const input of bad) assert.doesNotThrow(() => sanitizeAnalyticsQuery(input, NOW));
  for (const input of bad.filter((b) => b.range !== "30d" && !Array.isArray(b.range))) assert.equal(sanitizeAnalyticsQuery(input, NOW), "range=7d", JSON.stringify(input));
  assert.equal(sanitizeAnalyticsQuery({ range: ["30d", "7d"] }, NOW), "range=30d", "the first value of a repeated parameter wins");
});
test("the page sanitises searchParams on the server and the shell mirrors changes back into the URL", () => {
  assert.match(pageSrc, /searchParams: Promise</);
  assert.match(pageSrc, /sanitizeAnalyticsQuery\(await searchParams/);
  assert.match(pageSrc, /<AnalyticsV2 initialQuery=\{initialQuery\}/);
  assert.match(v2Ui, /useState\(initialQuery\)/);
  assert.match(v2Ui, /window\.history\.replaceState/);
});

// ---- Turkish, fail-closed range errors -----------------------------------------------------------
test("range validation errors reach the admin in Turkish, and unknown codes fail closed to a generic Turkish message", () => {
  assert.equal(analyticsRangeErrorMessage("range too large"), "Özel tarih aralığı en fazla 400 gün olabilir.");
  const triggers = [resolveDateRange("custom", NOW), resolveDateRange("custom", NOW, "nope", "2026-01-01"), resolveDateRange("custom", NOW, "2026-09-25", "2026-09-01"), resolveDateRange("custom", NOW, "2020-01-01", "2026-09-01")];
  for (const t of triggers) {
    assert.equal(t.ok, false);
    if (!t.ok) assert.doesNotMatch(analyticsRangeErrorMessage(t.error), /range|must|requires|invalid|too large/i, `"${t.error}" must not leak in English`);
  }
  assert.equal(analyticsRangeErrorMessage("something unexpected"), "Geçersiz tarih aralığı.");
});
test("both analytics routes answer range errors through the Turkish mapping and stay fail-closed (400)", () => {
  for (const file of ["../app/api/admin/analytics/sales/route.ts", "../app/api/admin/analytics/route.ts"]) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(src, /analyticsRangeErrorMessage\(resolved\.error\)/, file);
    assert.doesNotMatch(src, /error: resolved\.error/, `${file} must not echo the internal English code`);
    assert.match(src, /status: 400/);
  }
});

// ---- responsive / touch targets ------------------------------------------------------------------
test("the toolbar keeps the date inputs at a fixed readable width and only goes single-row on wide screens", () => {
  assert.match(toolbarUi, /grid w-40 gap-1\.5/, "each date field has a width that fits dd.mm.yyyy plus its picker icon");
  assert.match(toolbarUi, /min-\[1400px\]:flex-row/, "below ~1400px the presets and the date range stack instead of squeezing the inputs");
  assert.match(toolbarUi, /flex-wrap items-end gap-2 md:flex/, "the date group wraps rather than squeezing its inputs");
});
test("a linked top-product row has a 44px hit area", () => {
  assert.match(primitivesSrc, /<a className="inline-flex min-h-11 max-w-full items-center underline"/);
});
