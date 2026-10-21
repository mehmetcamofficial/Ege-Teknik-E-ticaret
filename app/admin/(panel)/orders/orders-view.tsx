"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, FormField, Notice, PageHeader, Panel, StatusBadge, selectClass } from "@/components/admin/ui";
import { RecordActions } from "@/components/admin/record-actions";
import { useAdminJson } from "@/components/admin/use-admin-data";
import { orderStatusLabel, orderStatusTone, paymentStatusLabel, trDate, tryCurrency } from "@/lib/admin-ui";
import type { OrderListPage } from "@/lib/orders-db";

/** Every row comes from GET /api/admin/orders (P0-A #3), paginated server-side - no 100-row cap. */
export default function OrdersView() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const url = useMemo(() => {
    const q = new URLSearchParams();
    if (query.trim()) q.set("q", query.trim());
    if (status) q.set("status", status);
    q.set("page", String(page));
    return `/api/admin/orders?${q}`;
  }, [query, status, page]);
  const { data, error, loading } = useAdminJson<OrderListPage>(url);
  const filter = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  return (
    <>
      <PageHeader title="Siparişler" description="Tüm siparişler, en yeniden eskiye." />
      {error && <Notice tone="error">{error}</Notice>}
      <Panel bodyClassName="p-0">
        <div role="search" className="grid grid-cols-1 gap-3 border-b p-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] sm:p-5">
          <FormField label="Ara" htmlFor="order-search">
            <div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="order-search" type="search" placeholder="Sipariş no, müşteri, il veya telefon" className="pl-9" value={query} onChange={(e) => filter(setQuery)(e.target.value)} /></div>
          </FormField>
          <FormField label="Durum" htmlFor="order-status">
            <select id="order-status" className={selectClass} value={status} onChange={(e) => filter(setStatus)(e.target.value)}><option value="">Tümü</option>{Object.entries(orderStatusLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </FormField>
        </div>
        <p className="px-4 pt-3 text-sm text-muted-foreground sm:px-5" aria-live="polite">
          {loading && !data ? "Yükleniyor…" : data ? `${data.total} sipariş${data.pageCount > 1 ? ` · sayfa ${data.page} / ${data.pageCount}` : ""}` : ""}
        </p>
        {data && !data.rows.length ? (
          <div className="p-4 sm:p-5"><EmptyState title={data.total ? "Filtreyle eşleşen sipariş yok" : "Henüz sipariş yok"} /></div>
        ) : (
          <>
            <div className="px-1 pb-2 sm:px-2">
              <Table>
                <TableHeader><TableRow><TableHead>Sipariş</TableHead><TableHead>Tarih</TableHead><TableHead>Müşteri</TableHead><TableHead className="text-right">Tutar</TableHead><TableHead>Ödeme</TableHead><TableHead>Durum</TableHead><TableHead className="text-left">İşlemler</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(data?.rows ?? []).map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium">{o.orderNumber}</TableCell>
                      <TableCell>{trDate(o.createdAt, true)}</TableCell>
                      <TableCell className="max-w-[14rem] whitespace-normal">{o.customerName}<p className="text-xs text-muted-foreground">{o.city}</p></TableCell>
                      <TableCell className="text-right tabular-nums">{tryCurrency(o.total)}</TableCell>
                      <TableCell>{paymentStatusLabel[o.paymentStatus] ?? o.paymentStatus}</TableCell>
                      <TableCell><StatusBadge tone={orderStatusTone[o.status] ?? "neutral"}>{orderStatusLabel[o.status] ?? o.status}</StatusBadge></TableCell>
                      <TableCell>
                        <RecordActions actions={[{ key: "view", href: `/admin/orders/${o.id}` }]} label={`${o.orderNumber} sipariş işlemleri`} align="start" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {data && data.pageCount > 1 && (
              <nav aria-label="Sayfalama" className="flex items-center justify-between gap-3 border-t p-4 sm:px-5">
                <Button type="button" variant="outline" className="min-h-11" disabled={data.page <= 1 || loading} onClick={() => setPage(data.page - 1)}>Önceki</Button>
                <span className="text-sm text-muted-foreground" aria-live="polite">Sayfa {data.page} / {data.pageCount}</span>
                <Button type="button" variant="outline" className="min-h-11" disabled={data.page >= data.pageCount || loading} onClick={() => setPage(data.page + 1)}>Sonraki</Button>
              </nav>
            )}
          </>
        )}
      </Panel>
    </>
  );
}
