"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, FormField, Notice, Panel, StatCard, StatusBadge, selectClass } from "@/components/admin/ui";
import { useAdminJson } from "@/components/admin/use-admin-data";
import { AnalyticsRangeToolbar } from "../../analytics-range-toolbar";
import { orderStatusLabel, orderStatusTone, paymentStatusLabel, paymentStatusTone, trDate, tryCurrency } from "@/lib/admin-ui";
import { orderPaymentStatuses, paymentMethodLabel, paymentMethods, type FinanceReport } from "@/lib/finance";

const methodName = (m: string) => paymentMethodLabel[m as keyof typeof paymentMethodLabel] ?? "Belirtilmemiş";

/** Every figure comes from GET /api/admin/finance, computed in SQL. Nothing here adds, estimates or fills a gap. */
export default function FinanceView() {
  const [range, setRange] = useState("range=30d");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [orderStatus, setOrderStatus] = useState("");
  const [method, setMethod] = useState("");
  const [page, setPage] = useState(1);

  const url = useMemo(() => {
    const q = new URLSearchParams(range);
    if (paymentStatus) q.set("paymentStatus", paymentStatus);
    if (orderStatus) q.set("orderStatus", orderStatus);
    if (method) q.set("method", method);
    q.set("page", String(page));
    return `/api/admin/finance?${q}`;
  }, [range, paymentStatus, orderStatus, method, page]);
  const { data, error, loading } = useAdminJson<FinanceReport>(url);
  const filter = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const s = data?.summary;

  return (
    <div className="grid gap-6">
      <AnalyticsRangeToolbar query={range} onQueryChange={filter(setRange)} loading={loading} />
      <div role="search" aria-label="Finans filtreleri" className="grid grid-cols-1 gap-3 rounded-xl border bg-card p-4 sm:grid-cols-3">
        <FormField label="Ödeme durumu" htmlFor="fin-payment-status">
          <select id="fin-payment-status" className={selectClass} value={paymentStatus} onChange={(e) => filter(setPaymentStatus)(e.target.value)}>
            <option value="">Tümü</option>{orderPaymentStatuses.map((v) => <option key={v} value={v}>{paymentStatusLabel[v] ?? v}</option>)}
          </select>
        </FormField>
        <FormField label="Sipariş durumu" htmlFor="fin-order-status">
          <select id="fin-order-status" className={selectClass} value={orderStatus} onChange={(e) => filter(setOrderStatus)(e.target.value)}>
            <option value="">Tümü</option>{Object.entries(orderStatusLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </FormField>
        <FormField label="Ödeme yöntemi" htmlFor="fin-method" hint="Seçilen yöntemle en az bir tahsilatı olan siparişler.">
          <select id="fin-method" className={selectClass} value={method} onChange={(e) => filter(setMethod)(e.target.value)}>
            <option value="">Tümü</option>{paymentMethods.map((v) => <option key={v} value={v}>{paymentMethodLabel[v]}</option>)}
          </select>
        </FormField>
      </div>
      <p className="-mt-3 text-xs text-muted-foreground">Tarih filtresi siparişin oluşturulma tarihine uygulanır; tahsilat ve iadeler bu siparişlere ait kayıtlardır.</p>

      {error && <Notice tone="error">{error}</Notice>}
      {!data && loading && <Notice tone="info">Yükleniyor…</Notice>}

      {s && (
        <>
          {s.unbackedPaidCount > 0 && (
            <Notice tone="error">{s.unbackedPaidCount} sipariş eski yöntemle &quot;Ödendi&quot; işaretlenmiş ancak bu siparişlerde hiçbir ödeme kaydı yok. Bu tutarlar tahsilata sayılmaz; tahsilat gerçekten alındıysa sipariş detayından ödemeyi kaydedin.</Notice>
          )}
          <section aria-label="Finans özeti" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard label="Sipariş tutarı" value={tryCurrency(s.orderValue)} hint={`${s.orderCount - s.cancelledCount} sipariş (iptaller hariç) · ciro değildir`} />
            <StatCard label="Tahsil edilen" tone="success" value={tryCurrency(s.collected)} hint="Yalnızca kayıtlı ödemeler" />
            <StatCard label="Bekleyen tahsilat" tone="warning" value={tryCurrency(s.outstanding)} hint="İptal edilmemiş siparişlerde kalan bakiye" />
            <StatCard label="İptal edilen" tone="danger" value={tryCurrency(s.cancelledValue)} hint={`${s.cancelledCount} sipariş`} />
            <StatCard label="İade edilen" value={tryCurrency(s.refunded)} hint="Tamamlanmış iade kayıtları" />
            <StatCard label="Net tahsilat" tone="info" value={tryCurrency(s.netCollected)} hint="Tahsil edilen − iade edilen" />
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Panel title="KDV ayrımı" description="İptaller hariç sipariş tutarı; sipariş anındaki KDV kaydından (canlı fiyattan değil).">
              <dl className="grid gap-2 text-sm">
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">KDV hariç</dt><dd className="tabular-nums">{tryCurrency(s.netOrderValue)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">KDV</dt><dd className="tabular-nums">{tryCurrency(s.vatTotal)}</dd></div>
                <div className="flex justify-between gap-3 border-t pt-2 font-semibold"><dt>KDV dahil</dt><dd className="tabular-nums">{tryCurrency(s.orderValue)}</dd></div>
              </dl>
            </Panel>
            <Panel title="Kasa · ödeme yöntemine göre" description="Kayıtlı tahsilatlar ve bunlara karşı yapılan iadeler.">
              {data.methods.length ? (
                <dl className="grid gap-2 text-sm">
                  {data.methods.map((m) => (
                    <div key={m.method} className="flex flex-wrap justify-between gap-3">
                      <dt>{methodName(m.method)} <span className="text-muted-foreground">({m.paymentCount} ödeme)</span></dt>
                      <dd className="tabular-nums">{tryCurrency(m.collected)}{m.refunded > 0 && <span className="text-muted-foreground"> · iade {tryCurrency(m.refunded)}</span>}</dd>
                    </div>
                  ))}
                </dl>
              ) : <EmptyState title="Bu dönemde kayıtlı tahsilat yok" description="Ödemeler sipariş detayından kaydedildiğinde burada görünür." />}
            </Panel>
          </div>

          <Panel title="Stok değeri ve kârlılık">
            <p className="text-sm text-muted-foreground">Maliyet verisi mevcut değil. Ürünlerde maliyet alanı bulunmadığı için stok değeri, brüt kâr ve marj hesaplanmaz; satış fiyatından tahmin yapılmaz.</p>
          </Panel>

          <Panel title="Satış raporu" description={`${s.orderCount} sipariş · sayfa ${data.page} / ${data.pageCount}`} bodyClassName="p-0">
            {data.rows.length ? (
              <div className="px-1 pb-2 sm:px-2">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Sipariş</TableHead><TableHead>Tarih</TableHead><TableHead>Müşteri</TableHead>
                    <TableHead className="text-right">Toplam</TableHead><TableHead className="text-right">KDV</TableHead><TableHead className="text-right">Tahsil</TableHead>
                    <TableHead>Yöntem</TableHead><TableHead>Ödeme</TableHead><TableHead>Sipariş durumu</TableHead><TableHead>İade</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {data.rows.map((r) => (
                      <TableRow key={r.orderId}>
                        <TableCell className="font-medium"><Link className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline" href={`/admin/orders/${r.orderId}`}>{r.orderNumber}</Link></TableCell>
                        <TableCell>{trDate(r.createdAt, true)}</TableCell>
                        <TableCell className="max-w-[12rem] whitespace-normal">{r.customerName}</TableCell>
                        <TableCell className="text-right tabular-nums">{tryCurrency(r.total)}</TableCell>
                        <TableCell className="text-right tabular-nums">{tryCurrency(r.vatTotal)}</TableCell>
                        <TableCell className="text-right tabular-nums">{tryCurrency(r.collected)}</TableCell>
                        <TableCell>{r.methods.length ? r.methods.map(methodName).join(", ") : "—"}</TableCell>
                        <TableCell>
                          <StatusBadge tone={paymentStatusTone[r.paymentStatus] ?? "neutral"}>{paymentStatusLabel[r.paymentStatus] ?? r.paymentStatus}</StatusBadge>
                          {r.storedPaymentStatus === "paid" && r.collected === 0 && <p className="mt-1 text-xs text-red-700">Kayıtsız &quot;Ödendi&quot;</p>}
                        </TableCell>
                        <TableCell><StatusBadge tone={orderStatusTone[r.orderStatus] ?? "neutral"}>{orderStatusLabel[r.orderStatus] ?? r.orderStatus}</StatusBadge></TableCell>
                        <TableCell>{r.refunded > 0 ? tryCurrency(r.refunded) : r.returnsCount > 0 ? `${r.returnsCount} ürün iadesi` : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : <div className="p-4 sm:p-5"><EmptyState title="Bu filtrelerle sipariş yok" description="Tarih aralığını veya filtreleri değiştirin." /></div>}
            {data.pageCount > 1 && (
              <nav aria-label="Sayfalama" className="flex items-center justify-between gap-3 border-t p-4 sm:px-5">
                <Button type="button" variant="outline" className="min-h-11" disabled={data.page <= 1 || loading} onClick={() => setPage(data.page - 1)}>Önceki</Button>
                <span className="text-sm text-muted-foreground" aria-live="polite">Sayfa {data.page} / {data.pageCount}</span>
                <Button type="button" variant="outline" className="min-h-11" disabled={data.page >= data.pageCount || loading} onClick={() => setPage(data.page + 1)}>Sonraki</Button>
              </nav>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
