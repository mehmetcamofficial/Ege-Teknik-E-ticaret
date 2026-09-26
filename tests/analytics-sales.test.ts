import assert from "node:assert/strict";
import test from "node:test";
import {
  averageOrderValue, cancellationRate, dateRangePresets, resolveDateRange, resolvePreviousRange,
  salesDelta, salesTotalsFrom, trendGranularityFor,
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
