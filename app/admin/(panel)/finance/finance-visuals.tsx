"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { FinanceMethodRow, FinanceSummary } from "@/lib/finance";
import { paymentMethodLabel } from "@/lib/finance";
import { tryCurrency } from "@/lib/admin-ui";
import { Panel } from "@/components/admin/ui";

const pct = (part: number, whole: number) => whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0;
const number = (value: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(value);
const methodLabel = (method: FinanceMethodRow["method"]) =>
  method === "unknown" ? "Belirtilmemiş" : paymentMethodLabel[method];

/** Visualizations use only aggregated ledger figures returned by the finance API.
 * Order value is not revenue, and an order's payment may be recorded outside the chosen date period.
 */
export function FinanceVisuals({ summary, methods, canViewProfitability }: {
  summary: FinanceSummary;
  methods: FinanceMethodRow[];
  canViewProfitability: boolean;
}) {
  const expected = summary.collected + summary.outstanding;
  const collectionRatio = pct(summary.collected, expected);
  const methodMaximum = Math.max(0, ...methods.map((m) => m.collected));
  const collectedNet = summary.netCollected;
  return (
    <div className="grid gap-6">
      <section aria-label="Tahsilat görünümü" className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border bg-card p-5 shadow-sm lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="text-base font-semibold">Tahsilat ilerlemesi</h2><p className="mt-1 text-xs text-muted-foreground">Kayıtlı tahsilat ve kalan bakiye karşılaştırması; ciro oranı değildir.</p></div>
            <strong className="text-xl tabular-nums">{number(collectionRatio)}%</strong>
          </div>
          <div role="img" aria-label={`Tahsil edilen ${tryCurrency(summary.collected)}, bekleyen ${tryCurrency(summary.outstanding)}`} className="flex h-4 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-emerald-600" style={{ width: `${collectionRatio}%` }} />
            <div className="h-full bg-amber-400" style={{ width: `${pct(summary.outstanding, expected)}%` }} />
          </div>
          <dl className="mt-4 flex flex-wrap justify-between gap-4 text-sm">
            <div><dt className="text-muted-foreground">Tahsil edilen</dt><dd className="font-semibold tabular-nums">{tryCurrency(summary.collected)}</dd></div>
            <div><dt className="text-muted-foreground">Bekleyen</dt><dd className="font-semibold tabular-nums">{tryCurrency(summary.outstanding)}</dd></div>
            <div><dt className="text-muted-foreground">İadeler sonrası net</dt><dd className="font-semibold tabular-nums">{tryCurrency(collectedNet)}</dd></div>
          </dl>
        </div>
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold">Kârlılık durumu</h2>
          <p className="mt-2 text-sm text-muted-foreground">Gerçek alış maliyetleri henüz kaydedilmediğinden ürün kârı, stok maliyet değeri ve net marj hesaplanamaz.</p>
          {canViewProfitability ? <Link href="/admin/finance/profitability" className="mt-5 inline-flex min-h-11 items-center gap-1 rounded-lg border border-primary/30 px-3 text-sm font-medium text-primary hover:bg-primary/5">
            Senaryo hesaplayıcıya git <ArrowUpRight aria-hidden="true" className="size-4" />
          </Link> : <p className="mt-4 text-xs text-muted-foreground">Kârlılık senaryoları yalnız Süper Yönetici yetkisindedir.</p>}
        </div>
      </section>
      <Panel title="Tahsilat yöntemleri" description="Yönteme göre gerçekleşmiş ödeme kayıtlarının karşılaştırması; kaydı olmayan tutarlar dahil değildir.">
        {methods.length && methodMaximum > 0 ? (
          <div className="grid gap-4">
            {methods.map((item) => (
              <div key={item.method}>
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">{methodLabel(item.method)} <span className="font-normal text-muted-foreground">· {item.paymentCount} ödeme</span></span>
                  <span className="tabular-nums">{tryCurrency(item.collected)}{item.refunded > 0 ? ` · iade: ${tryCurrency(item.refunded)}` : ""}</span>
                </div>
                <div role="img" aria-label={`${methodLabel(item.method)}: ${tryCurrency(item.collected)} tahsilat`} className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-emerald-600" style={{ width: `${pct(item.collected, methodMaximum)}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">Henüz kayıtlı tahsilat olmadığından yöntem grafiği gösterilemiyor.</p>}
      </Panel>
    </div>
  );
}
