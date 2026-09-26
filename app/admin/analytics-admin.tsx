"use client";

import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { BarRow, KpiCard } from "@/components/admin/analytics-primitives";
import { EmptyState, Notice, Panel } from "@/components/admin/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { useAdminJson } from "@/components/admin/use-admin-data";
import { rangeLabel, type AnalyticsRangePreset } from "@/app/admin/analytics-range-toolbar";
import { fillDailyVisitors, formatTrendBucket, type AnalyticsSummary } from "@/lib/analytics";
import { cn } from "@/lib/utils";

const n = (value: number) => new Intl.NumberFormat("tr-TR").format(value);
const deviceLabel: Record<"mobile" | "tablet" | "desktop", string> = { mobile: "Mobil", tablet: "Tablet", desktop: "Masaüstü" };

// Normal traffic is the brand green (the admin --primary token), the same as the sales charts.
const visitorsConfig = { visitors: { label: "Tekil ziyaretçi", color: "var(--primary)" } } satisfies ChartConfig;
// Recharts makes the chart <svg> keyboard-focusable (arrow keys walk the tooltip) and sets an inline `outline: none`
// on it, which no class can override - so the visible focus ring is drawn on the wrapper via :has(svg:focus-visible).
const chartFocus = "rounded-md has-[svg:focus-visible]:outline-2 has-[svg:focus-visible]:outline-offset-2 has-[svg:focus-visible]:outline-ring";

type DayRow = AnalyticsSummary["dailyTrend"][number] & { short: string; full: string };

function VisitorsTooltip({ active, payload }: { active?: boolean; payload?: readonly { payload?: unknown }[] }) {
  const row = payload?.[0]?.payload as DayRow | undefined;
  if (!active || !row) return null;
  return (
    <div className="grid min-w-40 gap-1.5 rounded-lg border bg-background px-3 py-2 text-xs shadow-xl">
      <p className="font-medium">{row.full}</p>
      <div className="flex items-center justify-between gap-6"><span className="text-muted-foreground">Tekil ziyaretçi</span><span className="font-semibold tabular-nums">{n(row.visitors)}</span></div>
      <div className="flex items-center justify-between gap-6"><span className="text-muted-foreground">Sayfa görüntüleme</span><span className="font-semibold tabular-nums">{n(row.pageViews)}</span></div>
    </div>
  );
}

/** A ranked list of real counts (top pages, devices ...) with an honest empty line instead of an empty box. */
function RankedList({ title, empty, children }: { title: string; empty: string; children: ReactNode[] }) {
  return (
    <Panel title={title} bodyClassName="py-3 sm:py-3">
      {children.length ? <ul>{children}</ul> : <p className="text-sm text-muted-foreground">{empty}</p>}
    </Panel>
  );
}

/**
 * First-party TRAFFIC analytics (Phase 6A), presented in the same design language as the sales overview
 * (Phase 3.3B.4): the same KPI card, the same panels, the same brand-green charts and the same
 * "Tablo olarak gör" alternative. The shared Analytics V2 toolbar owns the period, so sales and traffic
 * always describe one window; a rejected range shows the API's own Turkish reason.
 *
 * Only real first-party aggregates are shown - nothing is derived, estimated or invented here. With too
 * little data for a chart (fewer than two active days) the day's real numbers are stated in a line
 * instead of a near-empty chart. admin:read only; read-only, no export of raw events.
 */
export default function AnalyticsAdmin({ query }: { query: string }) {
  const { data, error, loading } = useAdminJson<AnalyticsSummary>(`/api/admin/analytics?${query}`);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (loading && !data) return <Notice tone="info">Ziyaretçi verileri yükleniyor…</Notice>;
  if (!data) return null;

  const range = (new URLSearchParams(query).get("range") ?? "7d") as AnalyticsRangePreset;
  const hasRangeData = data.totals.pageViews > 0;
  // Compare against the raw payload: the number of days that actually had visits decides chart vs. sentence.
  const activeDays = data.dailyTrend.length;
  const days: DayRow[] = fillDailyVisitors(data.dailyTrend, { start: new Date(data.range.start), end: new Date(data.range.end) })
    .map((d) => ({ ...d, ...formatTrendBucket(d.date, "day") }));
  const only = data.dailyTrend[0] ? formatTrendBucket(data.dailyTrend[0].date, "day").full : "";
  const max = (values: number[]) => Math.max(1, ...values);

  return (
    <div className="space-y-4">
      <section aria-label="Ziyaretçi özet göstergeleri" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard primary label={`Tekil ziyaretçi (${rangeLabel[range] ?? "Özel aralık"})`} value={n(data.totals.uniqueVisitors)} hint="Seçili aralıkta" />
        <KpiCard label="Sayfa görüntüleme" value={n(data.totals.pageViews)} hint="Seçili aralıkta" />
        <KpiCard label="Yeni / geri dönen" value={`${n(data.totals.newVisitors)} / ${n(data.totals.returningVisitors)}`} hint="Seçili aralıkta ziyaretçi" />
        <KpiCard label="Toplam ziyaretçi" value={n(data.totals.visitors)} hint="Tüm zamanlar" />
      </section>

      <section aria-label="Dönemsel ziyaretçi sayıları" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["Bugün", data.today], ["Bu hafta", data.thisWeek], ["Bu ay", data.thisMonth], ["Bu yıl", data.thisYear]].map(([label, value]) => (
          <div key={label as string} className="flex items-baseline justify-between gap-2 rounded-lg border bg-card px-3.5 py-2.5">
            <span className="text-xs font-medium text-muted-foreground">{label} <span className="font-normal">· tekil</span></span>
            <span className="text-lg font-semibold tabular-nums">{n(value as number)}</span>
          </div>
        ))}
      </section>

      {data.botEventsExcluded > 0 && <p className="text-sm text-muted-foreground">Bu aralıkta {n(data.botEventsExcluded)} bot ziyareti tespit edildi ve tüm sayılardan hariç tutuldu.</p>}

      {!hasRangeData ? (
        <EmptyState title="Bu tarih aralığında henüz kayıtlı ziyaret yok." description="Ziyaretler kaydedildikçe burada görünür." />
      ) : (
        <>
          <Panel title="Ziyaretçi Trendi" description={activeDays >= 2 ? "Günlük tekil ziyaretçi" : "Bu aralıkta ziyaret olan gün"}>
            {activeDays >= 2 ? (
              <>
                <p className="sr-only">Günlük tekil ziyaretçi grafiği, {days.length} gün, {activeDays} günde ziyaret var. Sayısal değerler aşağıdaki tabloda yer alır.</p>
                <ChartContainer config={visitorsConfig} className={cn("aspect-auto h-[200px] w-full min-w-0 sm:h-[220px]", chartFocus)} role="img" aria-label="Günlük tekil ziyaretçi trendi">
                  <BarChart data={days} margin={{ left: 0, right: 4, top: 16 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="short" tickLine={false} axisLine={false} tickMargin={8} minTickGap={14} />
                    <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
                    <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={(p) => <VisitorsTooltip active={p.active} payload={p.payload} />} />
                    <Bar dataKey="visitors" fill="var(--color-visitors)" radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false} />
                  </BarChart>
                </ChartContainer>
              </>
            ) : (
              // A single active day is not a trend: state its real numbers instead of drawing a lone bar or a full-width progress line.
              <p className="rounded-lg border bg-muted/30 px-4 py-3 text-sm tabular-nums">
                <span className="font-medium">{only}</span> · {n(data.dailyTrend[0]?.visitors ?? 0)} tekil ziyaretçi · {n(data.dailyTrend[0]?.pageViews ?? 0)} sayfa görüntüleme
              </p>
            )}
            <details className="mt-2 text-sm"><summary className="flex min-h-11 cursor-pointer items-center font-medium">Tablo olarak gör</summary>
              <Table className="mt-2"><TableHeader><TableRow><TableHead>Tarih</TableHead><TableHead>Ziyaretçi</TableHead><TableHead>Sayfa görüntüleme</TableHead></TableRow></TableHeader>
                <TableBody>{days.map((d) => <TableRow key={d.date}><TableCell>{d.full}</TableCell><TableCell className="tabular-nums">{n(d.visitors)}</TableCell><TableCell className="tabular-nums">{n(d.pageViews)}</TableCell></TableRow>)}</TableBody>
              </Table>
            </details>
          </Panel>

          <div className="grid gap-4 md:grid-cols-2 md:items-start">
            <RankedList title="En çok görüntülenen sayfalar" empty="Veri yok.">
              {data.topPages.map((p) => <BarRow key={p.path} label={p.path} value={p.views} max={max(data.topPages.map((x) => x.views))} />)}
            </RankedList>
            <RankedList title="En çok görüntülenen ürünler" empty="Veri yok.">
              {data.topProducts.map((p) => <BarRow key={p.productId} label={p.productName} value={p.views} max={max(data.topProducts.map((x) => x.views))} href={`/product.html?id=${encodeURIComponent(p.productId)}`} />)}
            </RankedList>
            <RankedList title="Cihaz dağılımı" empty="Veri yok.">
              {(["mobile", "tablet", "desktop"] as const).map((d) => <BarRow key={d} label={deviceLabel[d]} value={data.devices[d]} max={max([data.devices.mobile, data.devices.tablet, data.devices.desktop])} />)}
            </RankedList>
            <RankedList title="Yönlendiren kaynaklar" empty="Bilinen bir yönlendiren yok (doğrudan ziyaretler veya yönlendiren bilgisi paylaşılmayan kaynaklar).">
              {data.referrers.map((r) => <BarRow key={r.host} label={r.host} value={r.visits} max={max(data.referrers.map((x) => x.visits))} />)}
            </RankedList>
          </div>
        </>
      )}
    </div>
  );
}
