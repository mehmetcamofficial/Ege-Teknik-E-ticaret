"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Range = "today" | "7d" | "30d" | "month" | "year" | "custom";
type Summary = {
  range: { start: string; end: string };
  totals: { visitors: number; uniqueVisitors: number; pageViews: number; newVisitors: number; returningVisitors: number };
  today: number; thisWeek: number; thisMonth: number; thisYear: number;
  dailyTrend: { date: string; visitors: number; pageViews: number }[];
  topPages: { path: string; views: number }[];
  topProducts: { productId: string; productName: string; views: number }[];
  devices: { mobile: number; tablet: number; desktop: number };
  referrers: { host: string; visits: number }[];
  botEventsExcluded: number;
};

const rangeLabel: Record<Range, string> = { today: "Bugün", "7d": "Son 7 gün", "30d": "Son 30 gün", month: "Bu ay", year: "Bu yıl", custom: "Özel aralık" };
const n = (value: number) => new Intl.NumberFormat("tr-TR").format(value);
const deviceLabel: Record<"mobile" | "tablet" | "desktop", string> = { mobile: "Mobil", tablet: "Tablet", desktop: "Masaüstü" };

/** A labelled value next to a plain proportional bar. The bar is decorative (aria-hidden) - the
    number beside it is the real, accessible value, so nothing here is conveyed by graphics alone. */
function BarRow({ label, value, max, href }: { label: string; value: number; max: number; href?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const labelNode = href ? <a className="underline" href={href} target="_blank" rel="noreferrer">{label}</a> : <span>{label}</span>;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-1.5">
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm">{labelNode}</span>
          <span className="shrink-0 text-sm font-semibold tabular-nums">{n(value)}</span>
        </div>
        <div aria-hidden="true" className="mt-1 h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
      </div>
    </li>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{n(value)}</p></div>;
}

async function fetchSummary(range: Range, from: string, to: string): Promise<Summary | null> {
  const params = new URLSearchParams({ range });
  if (range === "custom") { params.set("from", from); params.set("to", to); }
  const r = await fetch(`/api/admin/analytics?${params}`);
  return r.ok ? ((await r.json()) as Summary) : null;
}

/** admin:read only (every authenticated admin role already has it). Read-only: no mutation, no export of raw events - only the same aggregates this component renders. */
export default function AnalyticsAdmin() {
  const [range, setRange] = useState<Range>("7d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState<Summary | null>(null);
  const [message, setMessage] = useState("Yükleniyor…");

  const apply = useCallback((result: Summary | null) => {
    if (!result) { setData(null); setMessage("Analitik veriler yüklenemedi."); return; }
    setData(result); setMessage("");
  }, []);

  // Custom range loads only on the explicit "Uygula" click (applyCustomRange), never automatically -
  // an incomplete from/to pair would otherwise fire a request on every keystroke.
  useEffect(() => {
    if (range === "custom") return;
    let cancelled = false;
    void (async () => {
      setMessage("Yükleniyor…");
      const result = await fetchSummary(range, "", "");
      if (!cancelled) apply(result);
    })();
    return () => { cancelled = true; };
  }, [range, apply]);

  async function applyCustomRange() {
    if (!customFrom || !customTo) return;
    setMessage("Yükleniyor…");
    apply(await fetchSummary("custom", customFrom, customTo));
    setRange("custom");
  }

  const hasRangeData = !!data && data.totals.pageViews > 0;
  const maxTrend = data ? Math.max(1, ...data.dailyTrend.map((d) => d.visitors)) : 1;
  const maxPage = data ? Math.max(1, ...data.topPages.map((p) => p.views)) : 1;
  const maxProduct = data ? Math.max(1, ...data.topProducts.map((p) => p.views)) : 1;
  const maxDevice = data ? Math.max(1, data.devices.mobile, data.devices.tablet, data.devices.desktop) : 1;
  const maxReferrer = data ? Math.max(1, ...data.referrers.map((r) => r.visits)) : 1;
  const dateFmt = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" });

  return (
    <Card>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Tarih aralığı">
            {(Object.keys(rangeLabel) as Range[]).filter((r) => r !== "custom").map((r) => (
              <Button key={r} type="button" className="min-h-11" variant={r === range ? "default" : "outline"} aria-pressed={r === range} onClick={() => setRange(r)}>{rangeLabel[r]}</Button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1.5"><Label htmlFor="analytics-from">Başlangıç</Label><Input id="analytics-from" type="date" className="min-h-11" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="analytics-to">Bitiş</Label><Input id="analytics-to" type="date" className="min-h-11" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></div>
            <Button type="button" className="min-h-11" variant={range === "custom" ? "default" : "outline"} disabled={!customFrom || !customTo} onClick={() => { setRange("custom"); void applyCustomRange(); }}>Uygula</Button>
          </div>
        </div>
        {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}

        {data && (
          <>
            <section aria-label="Özet göstergeler" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label="Toplam ziyaretçi (tüm zamanlar)" value={data.totals.visitors} />
              <Kpi label={`Tekil ziyaretçi (${rangeLabel[range]})`} value={data.totals.uniqueVisitors} />
              <Kpi label="Sayfa görüntüleme" value={data.totals.pageViews} />
              <Kpi label="Bugün" value={data.today} />
              <Kpi label="Bu hafta" value={data.thisWeek} />
              <Kpi label="Bu ay" value={data.thisMonth} />
              <Kpi label="Bu yıl" value={data.thisYear} />
              <Kpi label="Yeni / geri dönen" value={data.totals.newVisitors} />
            </section>
            {data.totals.returningVisitors > 0 && <p className="text-sm text-muted-foreground">{n(data.totals.newVisitors)} yeni, {n(data.totals.returningVisitors)} geri dönen ziyaretçi (bu aralıkta).</p>}
            {data.botEventsExcluded > 0 && <p className="text-sm text-muted-foreground">Bu aralıkta {n(data.botEventsExcluded)} bot ziyareti tespit edildi ve tüm sayılardan hariç tutuldu.</p>}

            {!hasRangeData ? (
              <p className="text-sm text-muted-foreground">Bu tarih aralığında henüz kayıtlı ziyaret yok.</p>
            ) : (
              <>
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Günlük ziyaretçi trendi</h3>
                  <ul className="divide-y" aria-label="Günlük ziyaretçi trendi, tarih ve tekil ziyaretçi sayısı">{data.dailyTrend.map((d) => <BarRow key={d.date} label={dateFmt(d.date)} value={d.visitors} max={maxTrend} />)}</ul>
                  <details className="mt-2 text-sm"><summary className="flex min-h-11 cursor-pointer items-center">Tablo olarak gör</summary>
                    <Table className="mt-2"><TableHeader><TableRow><TableHead>Tarih</TableHead><TableHead>Ziyaretçi</TableHead><TableHead>Sayfa görüntüleme</TableHead></TableRow></TableHeader>
                      <TableBody>{data.dailyTrend.map((d) => <TableRow key={d.date}><TableCell>{dateFmt(d.date)}</TableCell><TableCell>{n(d.visitors)}</TableCell><TableCell>{n(d.pageViews)}</TableCell></TableRow>)}</TableBody>
                    </Table>
                  </details>
                </section>

                <div className="grid gap-6 lg:grid-cols-2">
                  <section>
                    <h3 className="mb-2 text-sm font-semibold">En çok görüntülenen sayfalar</h3>
                    {data.topPages.length ? <ul>{data.topPages.map((p) => <BarRow key={p.path} label={p.path} value={p.views} max={maxPage} />)}</ul> : <p className="text-sm text-muted-foreground">Veri yok.</p>}
                  </section>
                  <section>
                    <h3 className="mb-2 text-sm font-semibold">En çok görüntülenen ürünler</h3>
                    {data.topProducts.length ? <ul>{data.topProducts.map((p) => <BarRow key={p.productId} label={p.productName} value={p.views} max={maxProduct} href={`/product.html?id=${encodeURIComponent(p.productId)}`} />)}</ul> : <p className="text-sm text-muted-foreground">Veri yok.</p>}
                  </section>
                  <section>
                    <h3 className="mb-2 text-sm font-semibold">Cihaz dağılımı</h3>
                    <ul>{(["mobile", "tablet", "desktop"] as const).map((d) => <BarRow key={d} label={deviceLabel[d]} value={data.devices[d]} max={maxDevice} />)}</ul>
                  </section>
                  <section>
                    <h3 className="mb-2 text-sm font-semibold">Yönlendiren kaynaklar</h3>
                    {data.referrers.length ? <ul>{data.referrers.map((r) => <BarRow key={r.host} label={r.host} value={r.visits} max={maxReferrer} />)}</ul> : <p className="text-sm text-muted-foreground">Bilinen bir yönlendiren yok (doğrudan ziyaretler veya yönlendiren bilgisi paylaşılmayan kaynaklar).</p>}
                  </section>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
