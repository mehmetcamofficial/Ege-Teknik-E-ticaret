"use client";

import Link from "next/link";
import { ArrowRight, Boxes, ClipboardList, PackagePlus, Wrench } from "lucide-react";
import { EmptyState, Notice, PageHeader, Panel, StatCard, StatusBadge } from "@/components/admin/ui";
import { useAdminJson, type Overview } from "@/components/admin/use-admin-data";
import { LOW_STOCK_THRESHOLD, OPEN_SERVICE_STATUSES, orderStatusLabel, orderStatusTone, serviceStatusLabel, serviceStatusTone, stockLabel, stockLevel, stockTone, trDate, tryCurrency } from "@/lib/admin-ui";

type AnalyticsSummary = { totals: { uniqueVisitors: number; pageViews: number }; today: number };
type PendingReview = { id: string; productName: string; rating: number; displayName: string; createdAt: string };
const n = (v: number) => new Intl.NumberFormat("tr-TR").format(v);
const linkCls = "text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded-sm";

/** "What requires my attention?" - every number here comes from an existing admin endpoint; nothing is estimated. */
export default function DashboardView({ canModerateReviews, canViewProfitability }: { canModerateReviews: boolean; canViewProfitability: boolean }) {
  const overview = useAdminJson<Overview>("/api/admin/overview");
  const analytics = useAdminJson<AnalyticsSummary>("/api/admin/analytics?range=7d");
  const reviews = useAdminJson<{ reviews: PendingReview[] }>(canModerateReviews ? "/api/admin/reviews?status=pending" : null);

  const d = overview.data;
  const stockAlerts = d ? d.products.map((p) => ({ p, level: stockLevel(p) })).filter((x) => x.level === "out" || x.level === "low").sort((a, b) => a.p.stock - b.p.stock) : [];
  const openRequests = d ? d.requests.filter((r) => (OPEN_SERVICE_STATUSES as readonly string[]).includes(r.status)) : [];
  const newRequests = d ? d.requests.filter((r) => r.status === "new") : [];
  const published = d ? d.products.filter((p) => p.status === "published").length : 0;

  return (
    <>
      <PageHeader title="Genel Bakış" description="Dikkat gerektiren işler ve güncel durum." />
      <section aria-label="Hızlı işlemler" className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="font-semibold">Hızlı işlemler</h2><p className="text-sm text-muted-foreground">En sık kullanılan ekranlara tek tıkla ulaşın.</p></div>
          <span className="text-xs text-muted-foreground">⌘ K / Ctrl K</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {([
            { href: "/admin/orders", label: "Siparişler", icon: ClipboardList },
            { href: "/admin/service-requests", label: "Servis talepleri", icon: Wrench },
            { href: "/admin/products", label: "Ürün yönetimi", icon: PackagePlus },
            { href: "/admin/inventory", label: "Stok kontrolü", icon: Boxes },
            ...(canViewProfitability ? [{ href: "/admin/finance/profitability", label: "Kârlılık", icon: ClipboardList }] : []),
          ]).map((action) => {
            const Icon = action.icon;
            return <Link key={action.href} href={action.href} className="flex min-h-14 items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm font-medium hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <Icon aria-hidden="true" className="size-4 shrink-0 text-primary" /><span className="min-w-0 flex-1">{action.label}</span><ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            </Link>;
          })}
        </div>
      </section>
      {overview.error && <Notice tone="error">{overview.error}</Notice>}
      {overview.loading && !d && <Notice tone="info">Yükleniyor…</Notice>}

      {d && (
        <>
          <section aria-label="Öncelikli işler" className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 sm:p-5">
            <h2 className="mb-3 text-base font-semibold">Öncelikli işler</h2>
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                { label: "Yeni servis talepleri", count: newRequests.length, href: "/admin/service-requests" },
                { label: "Stok uyarıları", count: stockAlerts.length, href: "/admin/inventory" },
                { label: "Açık servis süreçleri", count: openRequests.length, href: "/admin/service-requests" },
              ].map((item) => <Link href={item.href} key={item.label} className="flex min-h-14 items-center justify-between gap-3 rounded-lg border bg-white px-4 py-3 hover:border-emerald-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                <span className="text-sm font-medium">{item.label}</span><span className="rounded-md bg-slate-100 px-2 py-1 text-sm font-semibold tabular-nums">{n(item.count)}</span>
              </Link>)}
            </div>
          </section>
          <section aria-label="Özet göstergeler" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard label="Ürün" value={n(d.products.length)} hint={`${n(published)} yayında`} href="/admin/products" />
            <StatCard label="Sipariş" value={n(d.orders.length)} hint={d.orders.length >= 100 ? "Son 100 kayıt gösteriliyor" : "Tüm kayıtlar"} href="/admin/orders" tone="info" />
            <StatCard label="Açık servis talebi" value={n(openRequests.length)} hint={`${n(newRequests.length)} yeni, henüz aranmadı`} href="/admin/service-requests" tone={newRequests.length ? "warning" : "neutral"} />
            <StatCard label="Stok uyarısı" value={n(stockAlerts.length)} hint={`Online satış, ≤${LOW_STOCK_THRESHOLD} adet`} href="/admin/inventory" tone={stockAlerts.some((x) => x.level === "out") ? "danger" : stockAlerts.length ? "warning" : "success"} />
          </section>

          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
            <Panel title="Yeni servis talepleri" description="Henüz aranmamış talepler" actions={<Link href="/admin/service-requests" className={linkCls}>Tümü</Link>}>
              {newRequests.length ? (
                <ul className="divide-y">
                  {newRequests.slice(0, 5).map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <div className="min-w-0"><p className="truncate font-medium">{r.name} <span className="font-normal text-muted-foreground">· {r.city}</span></p><p className="truncate text-sm text-muted-foreground">{r.type} · {trDate(r.createdAt)}</p></div>
                      <StatusBadge tone={serviceStatusTone[r.status] ?? "neutral"}>{serviceStatusLabel[r.status] ?? r.status}</StatusBadge>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState title="Bekleyen yeni talep yok" />}
            </Panel>

            <Panel title="Son siparişler" actions={<Link href="/admin/orders" className={linkCls}>Tümü</Link>}>
              {d.orders.length ? (
                <ul className="divide-y">
                  {d.orders.slice(0, 5).map((o) => (
                    <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <div className="min-w-0"><Link href={`/admin/orders/${o.id}`} className="font-medium underline-offset-4 hover:underline">{o.orderNumber}</Link><p className="truncate text-sm text-muted-foreground">{o.customerName} · {trDate(o.createdAt)}</p></div>
                      <div className="flex items-center gap-3"><span className="text-sm tabular-nums">{tryCurrency(o.total)}</span><StatusBadge tone={orderStatusTone[o.status] ?? "neutral"}>{orderStatusLabel[o.status] ?? o.status}</StatusBadge></div>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState title="Henüz sipariş yok" />}
            </Panel>

            <Panel title="Stok uyarıları" description={`Online satıştaki yayında ürünler; az stok eşiği ${LOW_STOCK_THRESHOLD} adet.`} actions={<Link href="/admin/inventory" className={linkCls}>Stok yönetimi</Link>}>
              {stockAlerts.length ? (
                <ul className="divide-y">
                  {stockAlerts.slice(0, 6).map(({ p, level }) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <div className="min-w-0"><p className="truncate font-medium">{p.name}</p><p className="text-sm text-muted-foreground">{p.sku || "SKU yok"} · {n(p.stock)} adet</p></div>
                      <StatusBadge tone={stockTone[level]}>{stockLabel[level]}</StatusBadge>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState title="Stok uyarısı yok" description="Online satıştaki yayında ürünlerin hepsinde yeterli stok var." />}
            </Panel>

            {canModerateReviews && (
              <Panel title="İncelemedeki yorumlar" actions={<Link href="/admin/reviews" className={linkCls}>Yorumlara git</Link>}>
                {reviews.error ? <Notice tone="error">{reviews.error}</Notice> : reviews.data?.reviews.length ? (
                  <ul className="divide-y">
                    {reviews.data.reviews.slice(0, 5).map((r) => (
                      <li key={r.id} className="py-2.5"><p className="truncate font-medium">{r.productName}</p><p className="text-sm text-muted-foreground">{r.displayName} · {r.rating}/5 · {trDate(r.createdAt)}</p></li>
                    ))}
                  </ul>
                ) : reviews.loading ? <p className="text-sm text-muted-foreground">Yükleniyor…</p> : <EmptyState title="İnceleme bekleyen yorum yok" />}
              </Panel>
            )}

            <Panel title="Ziyaretçi özeti" description="Son 7 gün, bot trafiği hariç" actions={<Link href="/admin/analytics" className={linkCls}>Analitik</Link>}>
              {analytics.data ? (
                <dl className="grid grid-cols-3 gap-3">
                  {[["Tekil ziyaretçi", analytics.data.totals.uniqueVisitors], ["Sayfa görüntüleme", analytics.data.totals.pageViews], ["Bugün", analytics.data.today]].map(([label, value]) => (
                    <div key={label as string} className="rounded-lg bg-muted/60 p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{n(value as number)}</dd></div>
                  ))}
                </dl>
              ) : analytics.error ? <Notice tone="error">{analytics.error}</Notice> : <p className="text-sm text-muted-foreground">Yükleniyor…</p>}
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
