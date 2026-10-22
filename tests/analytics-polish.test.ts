import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fillDailyVisitors, resolveDateRange } from "../lib/analytics.ts";

/**
 * Phase 3.3B.4 - Analytics premium polish. Source-level guards for the layout/accessibility decisions
 * (there is no DOM in this suite) plus the pure helper behind the traffic trend.
 */
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const sales = strip(read("app/admin/analytics-sales.tsx"));
const traffic = strip(read("app/admin/analytics-admin.tsx"));
const primitives = read("components/admin/analytics-primitives.tsx");
const toolbar = read("app/admin/analytics-range-toolbar.tsx");
const shell = strip(read("app/admin/analytics-v2.tsx"));
const libSrc = read("lib/analytics.ts");

// ---- KPI: never clipped ----------------------------------------------------------------------------
test("a KPI value scales with its card and wraps instead of clipping; nothing is hidden with overflow-hidden", () => {
  const card = primitives.slice(primitives.indexOf("export function KpiCard"));
  assert.match(card, /@container/, "sized from the card's own width");
  assert.match(card, /clamp\([^)]*cqw[^)]*\)/, "value font-size follows the card width via container units");
  assert.match(card, /\[overflow-wrap:anywhere\]/, "an extreme figure wraps rather than clips");
  assert.doesNotMatch(card.slice(0, card.indexOf("</div>")), /overflow-hidden/, "the KPI card must not mask a too-wide number");
});
test("Sales and Traffic build their KPIs from the SAME card component", () => {
  assert.match(sales, /<KpiCard/);
  assert.match(traffic, /<KpiCard/);
  assert.doesNotMatch(sales + traffic, /function (Sales)?Kpi\b/, "no second, divergent KPI implementation");
});
test("the sales KPI grid gives the headline figure the widest column and stays compact on tablet", () => {
  assert.match(sales, /xl:grid-cols-\[1\.35fr_repeat\(4,minmax\(0,1fr\)\)\]/);
  assert.match(sales, /md:grid-cols-6/, "tablet: five KPIs in two short rows instead of three tall ones");
});

// ---- chart axis, colour, focus, status height ----------------------------------------------------
test("the money axis is wide enough for one-line labels and has headroom for the top tick", () => {
  const w = Number(/<YAxis tickLine=\{false\} axisLine=\{false\} width=\{(\d+)\} tickCount/.exec(sales)?.[1]);
  assert.ok(w >= 92, `money axis width ${w} must fit "₺125,6 milyon" on one line`);
  assert.match(sales, /<BarChart data=\{trend\} margin=\{\{ left: 0, right: 4, top: 16 \}\}/);
});
test("charts use the brand green design token, never the orange chart-1 (which reads as a warning)", () => {
  for (const [name, src] of [["sales", sales], ["traffic", traffic]] as const) {
    assert.match(src, /color: "var\(--primary\)"/, `${name} charts use --primary`);
    assert.doesNotMatch(src, /chart-\d|#[0-9a-fA-F]{6}\b|rgb\(/, `${name} must not introduce a hard-coded palette`);
  }
});
test("the chart <svg>, which Recharts makes keyboard-focusable, has a visible focus indicator", () => {
  for (const src of [sales, traffic]) {
    // Recharts writes an inline `outline: none` on the svg itself, so the ring must live on the wrapper.
    assert.match(src, /has-\[svg:focus-visible\]:outline-2/);
    assert.match(src, /has-\[svg:focus-visible\]:outline-ring/);
    assert.doesNotMatch(src, /\[&_svg:focus-visible\]/, "a class on the svg cannot beat the inline outline:none");
  }
});
test("the tablet-and-up status panel is not stretched to the trend panel's height", () => {
  assert.match(sales, /xl:grid-cols-3 xl:items-start/);
});

// ---- traffic: same product, real data only --------------------------------------------------------
test("the traffic view still presents every real first-party metric of the API payload", () => {
  for (const field of ["totals.visitors", "totals.uniqueVisitors", "totals.pageViews", "totals.newVisitors", "totals.returningVisitors", "data.today", "data.thisWeek", "data.thisMonth", "data.thisYear", "dailyTrend", "topPages", "topProducts", "data.devices", "data.referrers", "botEventsExcluded"]) {
    assert.ok(traffic.includes(field), `traffic must keep showing ${field}`);
  }
});
test("no fabricated numbers: neither Analytics view carries a hard-coded metric, mock or random value", () => {
  for (const [name, src] of [["sales", sales], ["traffic", traffic]] as const) {
    assert.doesNotMatch(src, /Math\.random\(|\b(mock|fake|dummy|lorem|placeholder)\b/i, `${name}: no synthetic data`);
    assert.doesNotMatch(src, /value=\{?"?\d/, `${name}: a displayed value must never be a literal`);
    assert.doesNotMatch(src, />\s*₺\s?\d|\+\s*%\s?\d|%\s?\d{2,}\s*</, `${name}: no hard-coded money or growth figure in the markup`);
  }
});
test("the traffic view shows the API's own (Turkish) range error instead of a generic failure", () => {
  assert.match(traffic, /useAdminJson<AnalyticsSummary>/);
  assert.match(traffic, /if \(error\) return <Notice tone="error">\{error\}<\/Notice>/);
  assert.doesNotMatch(traffic, /Analitik veriler yüklenemedi/);
});
test("one active day is stated as a sentence, not drawn as a lone full-width bar or progress line", () => {
  assert.match(traffic, /activeDays >= 2/);
  assert.match(traffic, /tekil ziyaretçi ·/);
  assert.doesNotMatch(traffic, /BarRow[^\n]*days|dailyTrend\.map\(\(d\) => <BarRow/, "the daily trend is no longer a list of progress bars");
});
test("the traffic trend fills quiet days with explicit zeros, inside the Istanbul range", () => {
  const r = resolveDateRange("7d", new Date("2026-06-04T12:00:00.000Z"));
  if (!r.ok) throw new Error("unreachable");
  const filled = fillDailyVisitors([{ date: "2026-06-02", visitors: 2, pageViews: 5 }, { date: "2026-06-04", visitors: 1, pageViews: 1 }], r.range);
  assert.equal(filled.length, 7);
  assert.deepEqual(filled.find((d) => d.date === "2026-06-03"), { date: "2026-06-03", visitors: 0, pageViews: 0 });
  assert.equal(filled.find((d) => d.date === "2026-06-02")?.visitors, 2);
  assert.equal(fillDailyVisitors([], r.range).every((d) => d.visitors === 0 && d.pageViews === 0), true);
});
test("the bucket-filling helpers stay pure (no fetch, no Date.now)", () => {
  const fn = libSrc.slice(libSrc.indexOf("export function fillDailyVisitors"));
  assert.doesNotMatch(fn, /fetch\(|Date\.now\(|new Date\(\)/);
});

// ---- URL canonicalisation --------------------------------------------------------------------------
test("a URL the server corrected is rewritten to the canonical state with replaceState, once, without looping", () => {
  assert.match(shell, /useEffect\(\(\) => \{/);
  assert.match(shell, /new URLSearchParams\(window\.location\.search\)\.toString\(\) !== initialQuery/, "only when the address differs from the canonical state");
  assert.match(shell, /window\.history\.replaceState/);
  assert.doesNotMatch(shell, /history\.pushState|router\.push/, "no history entries are added");
  assert.match(shell, /\}, \[initialQuery\]\)/, "keyed on the server-sanitised value, so it cannot loop");
});

// ---- mobile toolbar ---------------------------------------------------------------------------------
test("the mobile toolbar keeps every preset and the custom range reachable, behind a 44px disclosure", () => {
  assert.match(toolbar, /grid grid-cols-3 gap-2 sm:flex sm:flex-wrap/, "presets are a compact 3-column grid on a phone");
  assert.match(toolbar, /aria-expanded=\{customOpen\}/);
  assert.match(toolbar, /aria-controls="analytics-custom-range"/);
  assert.match(toolbar, /className="min-h-11 justify-start gap-2 md:hidden"/, "the disclosure is a 44px button, phone/tablet only");
  assert.match(toolbar, /md:flex", customOpen \? "flex" : "hidden"/, "from md up the date fields are always visible");
  assert.match(toolbar, /useState\(active === "custom"\)/, "an active custom range starts expanded");
  assert.match(toolbar, /id="analytics-from" type="date" className="min-h-11"/);
});
