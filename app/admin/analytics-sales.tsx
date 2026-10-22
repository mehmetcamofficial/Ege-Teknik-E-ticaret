"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { KpiCard } from "@/components/admin/analytics-primitives";
import { EmptyState, Notice, Panel, StatusBadge } from "@/components/admin/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { orderStatusLabel, orderStatusTone, tryCurrency } from "@/lib/admin-ui";
import { formatTrendBucket, formatTryAxis, salesDelta, type SalesSummary } from "@/lib/analytics";
import { useAdminJson } from "@/components/admin/use-admin-data";
import { cn } from "@/lib/utils";

/**
 * Sales overview (Phase 3.3B, V2.1) - an aggregate-only operational dashboard.
 *
 * TERMINOLOGY, enforced throughout: the headline number is "Sipariş Tutarı" (order value = the sum of
 * `orders.total`, the amount customers were asked to pay, VAT-inclusive). It is never "ciro" and
 * never "tahsilat". There is no payment provider, so nothing here means money actually collected, and
 * nothing here is derived from `orders.payment_status`. The page carries a permanent note saying so.
 *
 * Every figure arrives from `/api/admin/analytics/sales`, which returns aggregates only - no order
 * row, no customer name, phone, email or address ever reaches the browser - and already as numbers
 * (the bigint-string conversion happens server-side in `buildSalesSummary`, not here). Missing days
 * arrive as explicit zero buckets, so the chart shows quiet days as quiet.
 *
 * Recharts + components/ui/chart are used exactly as they already exist in the project; no charting
 * dependency was added. Every chart is paired with a real table so the data is never conveyed by
 * graphics alone.
 */

const number = (value: number) => new Intl.NumberFormat("tr-TR").format(value);
const percent = (value: number) => `%${value.toFixed(1).replace(".", ",")}`;
const statusLabel = (status: string) => orderStatusLabel[status] ?? status;

// A config entry without a colour renders the series BLACK: ChartContainer only emits a
// `--color-<key>` custom property for entries that have one.
// Normal data is drawn in the brand green (the admin --primary token). Amber/red stay reserved for warning
// and error states, so an ordinary sales figure never reads like an alert.
const trendConfig = { orderValue: { label: "Sipariş Tutarı", color: "var(--primary)" } } satisfies ChartConfig;
const statusConfig = { count: { label: "Sipariş Sayısı", color: "var(--primary)" } } satisfies ChartConfig;

// Recharts makes the chart <svg> keyboard-focusable (arrow keys walk the tooltip) and sets an inline `outline: none`
// on it, which no class can override - so the visible focus ring is drawn on the wrapper via :has(svg:focus-visible).
const chartFocus = "rounded-md has-[svg:focus-visible]:outline-2 has-[svg:focus-visible]:outline-offset-2 has-[svg:focus-visible]:outline-ring";

/**
 * The comparison line inside each KPI. A percentage change from a previous value of 0 is undefined
 * rather than infinite, so `salesDelta` gives `percent: null` there and the card says so instead of
 * showing a number the data cannot support. `null` inputs (an average/rate over zero orders) are
 * "no data", never coerced to 0.
 *
 * `higherIsBetter` is false ONLY for the cancellation rate: fewer cancellations is good news, so a
 * fall must not be painted red. `points` reports that rate as a percentage-point difference, which is
 * how a rate change is read; every other metric is a relative percentage.
 */
function Delta({ current, previous, format, higherIsBetter = true, points = false }: { current: number | null; previous: number | null; format: (v: number) => string; higherIsBetter?: boolean; points?: boolean }) {
  const base = "mt-2 border-t pt-2 text-xs tabular-nums";
  if (previous === null) return <p className={cn(base, "text-muted-foreground")}>Önceki dönemde veri yok</p>;
  if (current === null) return <p className={cn(base, "text-muted-foreground")}>Bu dönemde veri yok · önceki dönem {format(previous)}</p>;
  const d = salesDelta(current, previous);
  if (d.percent === null) return <p className={cn(base, "text-muted-foreground")}>{current === 0 && previous === 0 ? "İki dönemde de kayıt yok" : `Önceki dönemde veri yok · ${format(previous)}`}</p>;
  if (d.difference === 0) return <p className={cn(base, "text-muted-foreground")}>Önceki dönemle aynı · {format(previous)}</p>;
  const good = higherIsBetter ? d.difference > 0 : d.difference < 0;
  const tone = good ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400";
  const change = points ? `${Math.abs(d.difference).toFixed(1).replace(".", ",")} puan` : percent(Math.abs(d.percent));
  return (
    <p className={cn(base, "text-muted-foreground")}>
      <span className={cn("font-medium", tone)}>{d.difference > 0 ? "▲" : "▼"} {change}</span> · önceki dönem {format(previous)}
    </p>
  );
}

type TrendRow = SalesSummary["trend"][number] & { short: string; full: string };
type TooltipProps = { active?: boolean; payload?: readonly { payload?: unknown }[] };
const tooltipShell = "grid min-w-40 gap-1.5 rounded-lg border bg-background px-3 py-2 text-xs shadow-xl";

function TrendTooltip({ active, payload }: TooltipProps) {
  const row = payload?.[0]?.payload as TrendRow | undefined;
  if (!active || !row) return null;
  return (
    <div className={tooltipShell}>
      <p className="font-medium">{row.full}</p>
      <div className="flex items-center justify-between gap-6"><span className="text-muted-foreground">Sipariş Tutarı</span><span className="font-semibold tabular-nums">{tryCurrency(row.orderValue)}</span></div>
      <div className="flex items-center justify-between gap-6"><span className="text-muted-foreground">Sipariş Sayısı</span><span className="font-semibold tabular-nums">{number(row.orderCount)}</span></div>
    </div>
  );
}

type StatusRow = SalesSummary["statuses"][number] & { share: number };
function StatusTooltip({ active, payload }: TooltipProps) {
  const row = payload?.[0]?.payload as StatusRow | undefined;
  if (!active || !row) return null;
  return (
    <div className={tooltipShell}>
      <p className="font-medium">{statusLabel(row.status)}</p>
      <div className="flex items-center justify-between gap-6"><span className="text-muted-foreground">Sipariş Sayısı</span><span className="font-semibold tabular-nums">{number(row.count)} · {percent(row.share)}</span></div>
      <div className="flex items-center justify-between gap-6"><span className="text-muted-foreground">Sipariş Tutarı</span><span className="font-semibold tabular-nums">{tryCurrency(row.orderValue)}</span></div>
    </div>
  );
}

export function SalesOverview({ rangeQuery }: { rangeQuery: string }) {
  const { data, error, loading } = useAdminJson<SalesSummary>(`/api/admin/analytics/sales?${rangeQuery}`);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (loading && !data) return <Notice tone="info">Satış verileri yükleniyor…</Notice>;
  if (!data) return null;

  const { totals, previous } = data;
  const granularityLabel = data.granularity === "day" ? "Günlük" : data.granularity === "week" ? "Haftalık" : "Aylık";
  const trend: TrendRow[] = data.trend.map((p) => ({ ...p, ...formatTrendBucket(p.bucket, data.granularity) }));
  const totalStatusOrders = data.statuses.reduce((sum, s) => sum + s.count, 0);
  const statuses: StatusRow[] = data.statuses.map((s) => ({ ...s, share: totalStatusOrders > 0 ? (s.count / totalStatusOrders) * 100 : 0 }));
  const activeDays = trend.filter((p) => p.orderCount > 0).length;
  const statusChartHeight = Math.max(180, statuses.length * 44 + 40);

  return (
    <div className="space-y-4">
      <Notice tone="info">
        <strong>Sipariş Tutarı</strong>, müşterilerin ödemek üzere talep oluşturduğu sipariş toplamıdır (KDV dahil, iptaller hariç). Ödeme
        kuruluşu entegrasyonu tamamlanmadığı için <strong>tahsil edilen para anlamına gelmez</strong>.
      </Notice>

      <section aria-label="Satış özet göstergeleri" className="grid grid-cols-2 gap-3 md:grid-cols-6 xl:grid-cols-[1.35fr_repeat(4,minmax(0,1fr))]">
        <KpiCard
          primary
          className="col-span-2 md:col-span-2 xl:col-span-1"
          label="Sipariş Tutarı"
          value={tryCurrency(totals.orderValue)}
          hint={`Net ${tryCurrency(totals.netOrderValue)} + KDV ${tryCurrency(totals.vatTotal)}`}
          footer={<Delta current={totals.orderValue} previous={previous.orderValue} format={tryCurrency} />}
        />
        <KpiCard
          className="md:col-span-2 xl:col-span-1"
          label="Sipariş Sayısı"
          value={number(totals.orderCount)}
          hint={`${number(totals.cancelledCount)} iptal`}
          footer={<Delta current={totals.orderCount} previous={previous.orderCount} format={number} />}
        />
        <KpiCard
          className="md:col-span-2 xl:col-span-1"
          label="Satılan Ürün Adedi"
          value={number(totals.unitsSold)}
          hint="Kalem bazında toplam"
          footer={<Delta current={totals.unitsSold} previous={previous.unitsSold} format={number} />}
        />
        <KpiCard
          className="md:col-span-3 xl:col-span-1"
          label="Ortalama Sipariş Tutarı"
          value={totals.averageOrderValue === null ? "—" : tryCurrency(totals.averageOrderValue)}
          hint="Sipariş başına"
          footer={<Delta current={totals.averageOrderValue} previous={previous.averageOrderValue} format={tryCurrency} />}
        />
        <KpiCard
          className="md:col-span-3 xl:col-span-1"
          label="İptal Oranı"
          value={totals.cancellationRate === null ? "—" : percent(totals.cancellationRate)}
          hint={`${number(totals.cancelledCount)} / ${number(totals.orderCount)} sipariş`}
          footer={<Delta current={totals.cancellationRate} previous={previous.cancellationRate} format={percent} higherIsBetter={false} points />}
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-3 xl:items-start">
        <Panel
          className="xl:col-span-2"
          title="Sipariş Tutarı"
          description={`${granularityLabel} dağılım${data.hasAnyOrders ? ` · ${number(activeDays)}/${number(trend.length)} dönemde sipariş var` : ""}`}
        >
          {data.hasAnyOrders ? (
            <>
              <p className="sr-only">
                {granularityLabel} sipariş tutarı grafiği, {trend.length} dönem noktası, {activeDays} dönemde sipariş var. Sayısal değerler aşağıdaki tabloda yer alır.
              </p>
              <ChartContainer config={trendConfig} className={cn("aspect-auto h-[240px] w-full min-w-0 sm:h-[280px]", chartFocus)} role="img" aria-label="Sipariş tutarı trendi">
                <BarChart data={trend} margin={{ left: 0, right: 4, top: 16 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="short" tickLine={false} axisLine={false} tickMargin={8} minTickGap={14} />
                  <YAxis tickLine={false} axisLine={false} width={96} tickCount={5} tickFormatter={(v: number) => formatTryAxis(v)} />
                  <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={(p) => <TrendTooltip active={p.active} payload={p.payload} />} />
                  <Bar dataKey="orderValue" fill="var(--color-orderValue)" radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false} />
                </BarChart>
              </ChartContainer>
              <details className="mt-2">
                <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">Tablo olarak gör</summary>
                <Table>
                  <TableHeader><TableRow><TableHead>Dönem</TableHead><TableHead>Sipariş Tutarı</TableHead><TableHead>Sipariş Sayısı</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {trend.map((p) => (
                      <TableRow key={p.bucket}>
                        <TableCell>{p.full}</TableCell>
                        <TableCell className="tabular-nums">{tryCurrency(p.orderValue)}</TableCell>
                        <TableCell className="tabular-nums">{number(p.orderCount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </details>
            </>
          ) : (
            <EmptyState title="Bu tarih aralığında sipariş yok" description="Seçili aralıkta henüz sipariş oluşmadı; grafik için gerçek veri yok." />
          )}
        </Panel>

        <Panel title="Sipariş Durumu" description="Dönemdeki tüm siparişler, iptaller dahil">
          {statuses.length ? (
            <>
              {statuses.length === 1 ? (
                // One status is not a distribution: a full-width bar for it would be a giant block that
                // says nothing a number does not. Show the facts as a compact summary instead.
                <div className="rounded-lg border bg-muted/30 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge tone={orderStatusTone[statuses[0]!.status] ?? "neutral"}>{statusLabel(statuses[0]!.status)}</StatusBadge>
                    <span className="text-sm font-semibold tabular-nums">{percent(statuses[0]!.share)}</span>
                  </div>
                  <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">{number(statuses[0]!.count)} <span className="text-base font-normal text-muted-foreground">sipariş</span></p>
                  <p className="mt-1 text-sm text-muted-foreground tabular-nums">{tryCurrency(statuses[0]!.orderValue)} Sipariş Tutarı</p>
                </div>
              ) : (
                <>
                  <p className="sr-only">Sipariş durumu dağılımı grafiği, {statuses.length} durum. Sayısal değerler aşağıdaki tabloda yer alır.</p>
                  <ChartContainer config={statusConfig} className={cn("aspect-auto w-full min-w-0", chartFocus)} style={{ height: statusChartHeight }} role="img" aria-label="Sipariş durumu dağılımı">
                    <BarChart data={statuses} layout="vertical" margin={{ left: 0, right: 16 }}>
                      <CartesianGrid horizontal={false} />
                      <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
                      <YAxis type="category" dataKey="status" tickLine={false} axisLine={false} width={116} tickFormatter={(v: string) => statusLabel(v)} />
                      <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={(p) => <StatusTooltip active={p.active} payload={p.payload} />} />
                      <Bar dataKey="count" fill="var(--color-count)" radius={[0, 4, 4, 0]} maxBarSize={28} isAnimationActive={false} />
                    </BarChart>
                  </ChartContainer>
                </>
              )}
              <details className="mt-2">
                <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">Tablo olarak gör</summary>
                <Table>
                  <TableHeader><TableRow><TableHead>Durum</TableHead><TableHead>Sipariş</TableHead><TableHead>Sipariş Tutarı</TableHead><TableHead>Pay</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {statuses.map((s) => (
                      <TableRow key={s.status}>
                        <TableCell>{statusLabel(s.status)}</TableCell>
                        <TableCell className="tabular-nums">{number(s.count)}</TableCell>
                        <TableCell className="tabular-nums">{tryCurrency(s.orderValue)}</TableCell>
                        <TableCell className="tabular-nums">{percent(s.share)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </details>
            </>
          ) : (
            <EmptyState title="Bu tarih aralığında sipariş yok" description="Gösterilecek sipariş durumu bulunmuyor." />
          )}
        </Panel>
      </div>
    </div>
  );
}
