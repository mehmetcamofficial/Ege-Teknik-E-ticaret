"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, FormField, Notice, PageHeader, Panel, StatusBadge, selectClass } from "@/components/admin/ui";
import { useAdminJson, type Overview } from "@/components/admin/use-admin-data";
import { orderStatusLabel, orderStatusTone, paymentStatusLabel, trDate, tryCurrency } from "@/lib/admin-ui";

export default function OrdersView() {
  const { data, error, loading } = useAdminJson<Overview>("/api/admin/overview");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    return (data?.orders ?? []).filter((o) => (!status || o.status === status) && (!q || [o.orderNumber, o.customerName, o.city].some((v) => v?.toLocaleLowerCase("tr").includes(q))));
  }, [data, query, status]);

  return (
    <>
      <PageHeader title="Siparişler" description={data && data.orders.length >= 100 ? "En son 100 sipariş gösteriliyor." : "Tüm siparişler, en yeniden eskiye."} />
      {error && <Notice tone="error">{error}</Notice>}
      <Panel bodyClassName="p-0">
        <div role="search" className="grid grid-cols-1 gap-3 border-b p-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] sm:p-5">
          <FormField label="Ara" htmlFor="order-search">
            <div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="order-search" type="search" placeholder="Sipariş no, müşteri veya il" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
          </FormField>
          <FormField label="Durum" htmlFor="order-status">
            <select id="order-status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Tümü</option>{Object.entries(orderStatusLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </FormField>
        </div>
        <p className="px-4 pt-3 text-sm text-muted-foreground sm:px-5" aria-live="polite">{loading && !data ? "Yükleniyor…" : `${rows.length} / ${data?.orders.length ?? 0} sipariş`}</p>
        {data && !rows.length ? (
          <div className="p-4 sm:p-5"><EmptyState title={data.orders.length ? "Filtreyle eşleşen sipariş yok" : "Henüz sipariş yok"} /></div>
        ) : (
          <div className="px-1 pb-2 sm:px-2">
            <Table>
              <TableHeader><TableRow><TableHead>Sipariş</TableHead><TableHead>Tarih</TableHead><TableHead>Müşteri</TableHead><TableHead className="text-right">Tutar</TableHead><TableHead>Ödeme</TableHead><TableHead>Durum</TableHead><TableHead><span className="sr-only">Detay</span></TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">{o.orderNumber}</TableCell>
                    <TableCell>{trDate(o.createdAt, true)}</TableCell>
                    <TableCell className="max-w-[14rem] whitespace-normal">{o.customerName}<p className="text-xs text-muted-foreground">{o.city}</p></TableCell>
                    <TableCell className="text-right tabular-nums">{tryCurrency(o.total)}</TableCell>
                    <TableCell>{paymentStatusLabel[o.paymentStatus] ?? o.paymentStatus}</TableCell>
                    <TableCell><StatusBadge tone={orderStatusTone[o.status] ?? "neutral"}>{orderStatusLabel[o.status] ?? o.status}</StatusBadge></TableCell>
                    <TableCell className="text-right"><Button asChild variant="outline" size="sm"><Link href={`/admin/orders/${o.id}`} aria-label={`${o.orderNumber} siparişinin detayı`}>Detay</Link></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>
    </>
  );
}
