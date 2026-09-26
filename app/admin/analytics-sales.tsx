"use client";

import type { ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { BarRow } from "@/components/admin/analytics-primitives";
import { EmptyState, Notice, Panel, StatCard } from "@/components/admin/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { orderStatusLabel, tryCurrency } from "@/lib/admin-ui";
import { salesDelta, type SalesSummary } from "@/lib/analytics";
import { useAdminJson } from "@/components/admin/use-admin-data";

/**
 * Sales overview (Phase 3.3B) - an aggregate-only premium dashboard.
 *
 * TERMINOLOGY, enforced throughout: the headline number is "Sipariş Tutarı" (order value = the sum of
 * `orders.total`, the amount customers were asked to pay, VAT-inclusive). It is never "ciro" and
 * never "tahsilat". There is no payment provider, so nothing here means money actually collected, and
 * nothing here is derived from `orders.payment_status`. The page carries a permanent note saying so.
 *
 * Every figure arrives from `/api/admin/analytics/sales`, which returns aggregates only - no order
 * row, no customer name, phone, email or address ever reaches the browser.
 *
 * Recharts + components/ui/chart are used exactly as they already exist in the project; no charting
 * dependency was added. Every chart is paired with a real table so the data is never conveyed by
 * graphics alone.
 */

const number = (value: number) => new Intl.NumberFormat("tr-TR").format(value);
const percent = (value: number) => `%${value.toFixed(1).replace(".", ",")}`;

/** Buckets arrive as `YYYY-MM-DD` (day/week) or `YYYY-MM` (month); label them for humans. */
function bucketLabel(bucket: string, granularity: string) {
  if (granularity === "month") {
    const [y, m] = bucket.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("tr-TR", { month: "short", year: "2-digit" });
  }
  return new Date(`${bucket}T12:00:00`).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" });
}

// Both configs declare an explicit colour: ChartContainer only emits a `--color-<key>` custom
// property for entries that have one, so a config without a colour renders the series BLACK.
const chartConfig = {
  orderValue: { label: "Sipariş Tutarı", color: "var(--color-chart-1)" },
  orderCount: { label: "Sipariş Sayısı", color: "var(--color-chart-2)" },
} satisfies ChartConfig;

const statusChartConfig = { count: { label: "Sipariş Sayısı", color: "var(--color-chart-1)" } } satisfies ChartConfig;

/**
 * The comparison line under each KPI. A percentage change from a previous value of 0 is undefined
 * rather than infinite, so `percent` is null there and the card says so instead of showing a number
 * the data cannot support.
 *
 * `higherIsBetter` is false ONLY for the cancellation rate: fewer cancellations is good news, so a
 * fall must not be painted red. Getting this wrong would tell the operator the opposite of the
 * truth about the one metric here where a decline is an improvement.
 */
function Delta({ current, previous, format, higherIsBetter = true }: { current: number; previous: number; format: (v: number) => string; higherIsBetter?: boolean }) {
  const d = salesDelta(current, previous);
  if (d.percent === null) {
    return <p className="mt-1.5 text-xs text-muted-foreground">Önceki dönemde veri yok · {format(previous)}</p>;
  }
  const flat = d.difference === 0;
  const good = higherIsBetter ? d.difference > 0 : d.difference < 0;
  const tone = flat ? "text-muted-foreground" : good ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
  return (
    <p className={`mt-1.5 text-xs tabular-nums ${tone}`}>
      {flat ? "Önceki dönemle aynı" : `${d.difference > 0 ? "▲" : "▼"} ${percent(Math.abs(d.percent))}`}
      <span className="text-muted-foreground"> · önceki dönem {format(previous)}</span>
    </p>
  );
}


/** A visually-hidden summary of a chart, so its figures are never conveyed by graphics alone. */
function ChartA11ySummary({ children }: { children: ReactNode }) {
  return <p className="sr-only">{children}</p>;
}

export function SalesOverview({ rangeQuery }: { rangeQuery: string }) {
  const { data, error, loading } = useAdminJson<SalesSummary>(`/api/admin/analytics/sales?${rangeQuery}`);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (loading && !data) return <Notice tone="info">Satış verileri yükleniyor…</Notice>;
  if (!data) return null;

  const { totals, previous } = data;
  const granularityLabel = data.granularity === "day" ? "Günlük" : data.granularity === "week" ? "Haftalık" : "Aylık";
  const trend = data.trend.map((p) => ({ ...p, label: bucketLabel(p.bucket, data.granularity) }));
  const maxStatus = Math.max(1, ...data.statuses.map((s) => s.count));

  return (
    <div className="space-y-6">
      <Notice tone="info">
        <strong>Sipariş Tutarı</strong>, müşterilerin ödemek üzere talep oluşturduğu sipariş toplamıdır (KDV dahil). Ödeme kuruluşu
        entegrasyonu tamamlanmadığı için bu tutar <strong>tahsil edilen para</strong> anlamına gelmez; iptal edilen siparişler
        hesaba katılmaz.
      </Notice>

      <section aria-label="Satış özet göstergeleri" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Sipariş Tutarı" value={tryCurrency(totals.orderValue)} hint="KDV dahil, iptaller hariç" tone="info" />
        <StatCard label="Sipariş Sayısı" value={number(totals.orderCount)} hint={`${number(totals.cancelledCount)} iptal`} />
        <StatCard label="Satılan Ürün Adedi" value={number(totals.unitsSold)} hint="Kalem bazında toplam" />
        <StatCard label="Ortalama Sipariş Tutarı" value={totals.averageOrderValue === null ? "—" : tryCurrency(totals.averageOrderValue)} hint="Sipariş başına ortalama" />
      </section>

      {/* Comparison lives in its own block rather than inside StatCard, so that shared primitive
          (and every other screen already using it) stays exactly as it was. */}
      <section aria-label="Önceki dönem karşılaştırması" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Sipariş Tutarı", cur: totals.orderValue, prev: previous.orderValue, fmt: tryCurrency },
          { label: "Sipariş Sayısı", cur: totals.orderCount, prev: previous.orderCount, fmt: number },
          { label: "Satılan Adet", cur: totals.unitsSold, prev: previous.unitsSold, fmt: number },
          { label: "İptal Oranı", cur: totals.cancellationRate ?? 0, prev: previous.cancellationRate ?? 0, fmt: (v: number) => percent(v), higherIsBetter: false },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">{kpi.label}</p>
            <Delta current={kpi.cur} previous={kpi.prev} format={kpi.fmt} higherIsBetter={kpi.higherIsBetter ?? true} />
          </div>
        ))}
      </section>


      <Panel title="Sipariş Tutarı ve Sipariş Sayısı" description={`${granularityLabel} dağılım`}>
        {data.hasAnyOrders ? (
          <>
            <ChartA11ySummary>
              {granularityLabel} sipariş tutarı ve sipariş sayısı grafiği, {trend.length} dönem noktası. Sayısal değerler aşağıdaki tabloda yer alır.
            </ChartA11ySummary>
            <ChartContainer config={chartConfig} className="aspect-auto h-[260px] w-full min-w-0 sm:h-[320px] lg:h-[360px]" role="img" aria-label="Sipariş tutarı ve sipariş sayısı trendi">
              <AreaChart data={trend} margin={{ left: 4, right: 4, top: 8 }}>
                <defs>
                  <linearGradient id="salesValueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-orderValue)" stopOpacity={0.45} />
                    <stop offset="95%" stopColor="var(--color-orderValue)" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
                <YAxis yAxisId="value" tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => new Intl.NumberFormat("tr-TR", { notation: "compact" }).format(v)} />
                <YAxis yAxisId="count" orientation="right" tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => (name === "orderValue" ? tryCurrency(Number(value)) : number(Number(value)))}
                      labelFormatter={(_, payload) => (payload?.[0]?.payload?.label as string) ?? ""}
                    />
                  }
                />
                <Area yAxisId="value" dataKey="orderValue" type="monotone" fill="url(#salesValueFill)" stroke="var(--color-orderValue)" strokeWidth={2} />
                <Area yAxisId="count" dataKey="orderCount" type="monotone" fill="var(--color-orderCount)" fillOpacity={0.1} stroke="var(--color-orderCount)" strokeWidth={2} />
                {/* Two series on two different axes: without a legend the reader cannot tell which
                    line is money and which is counts, and the colours alone do not say so. */}
                <ChartLegend content={<ChartLegendContent nameKey="dataKey" />} verticalAlign="bottom" />
              </AreaChart>
            </ChartContainer>
            <details className="mt-3">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">Tablo olarak gör</summary>
              <Table>
                <TableHeader><TableRow><TableHead>Dönem</TableHead><TableHead>Sipariş Tutarı</TableHead><TableHead>Sipariş Sayısı</TableHead></TableRow></TableHeader>
                <TableBody>
                  {trend.map((p) => (
                    <TableRow key={p.bucket}>
                      <TableCell>{p.label}</TableCell>
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


      <Panel title="Sipariş Durumu Dağılımı" description="Dönem içindeki tüm siparişler, iptaller dahil">
        {data.statuses.length ? (
          <>
            <ChartA11ySummary>
              Sipariş durumu dağılımı grafiği, {data.statuses.length} durum. Sayısal değerler aşağıdaki tabloda yer alır.
            </ChartA11ySummary>
            <div className="grid gap-6 lg:grid-cols-2 lg:items-center">
              <ChartContainer config={statusChartConfig} className="aspect-auto h-[300px] w-full min-w-0" role="img" aria-label="Sipariş durumu dağılımı">
                <BarChart data={data.statuses} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="status" tickLine={false} axisLine={false} width={112} tickFormatter={(v: string) => orderStatusLabel[v] ?? v} />
                  <ChartTooltip content={<ChartTooltipContent formatter={(value) => number(Number(value))} />} />
                  <Bar dataKey="count" fill="var(--color-count)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ChartContainer>
              <ul>
                {data.statuses.map((s) => (
                  <BarRow key={s.status} label={orderStatusLabel[s.status] ?? s.status} value={s.count} max={maxStatus} />
                ))}
              </ul>
            </div>
            <details className="mt-3">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">Tablo olarak gör</summary>
              <Table>
                <TableHeader><TableRow><TableHead>Durum</TableHead><TableHead>Sipariş Sayısı</TableHead><TableHead>Sipariş Tutarı</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.statuses.map((s) => (
                    <TableRow key={s.status}>
                      <TableCell>{orderStatusLabel[s.status] ?? s.status}</TableCell>
                      <TableCell className="tabular-nums">{number(s.count)}</TableCell>
                      <TableCell className="tabular-nums">{tryCurrency(s.orderValue)}</TableCell>
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
  );
}
