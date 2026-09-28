"use client";

import { Package } from "lucide-react";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, Notice, Panel } from "@/components/admin/ui";
import { useAdminJson } from "@/components/admin/use-admin-data";
import { tryCurrency } from "@/lib/admin-ui";

type OrderItem = { id: string; productName: string; productSku: string; capacity: string; quantity: number; unitPrice: number; vatRateBps: number; vatAmount: number; lineTotal: number; imageUrl: string | null };

const vatRate = (bps: number) => `%${(bps / 100).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`;
const model = (i: OrderItem) => [i.productSku, i.capacity].filter(Boolean).join(" · ") || "—";

function Thumb({ item }: { item: OrderItem }) {
  return (
    <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted/40">
      {item.imageUrl
        // eslint-disable-next-line @next/next/no-img-element -- admin thumbnail from an arbitrary product URL; no optimizer config
        ? <img src={item.imageUrl} alt="" loading="lazy" className="size-full object-contain" />
        : <Package aria-hidden="true" className="size-5 text-muted-foreground" />}
    </span>
  );
}

/** Lines exactly as sold (order_items snapshot): prices and VAT never follow later product edits. */
export default function OrderItemsPanel({ orderId }: { orderId: string }) {
  const { data, error } = useAdminJson<{ items: OrderItem[] }>(`/api/admin/orders/${orderId}`);
  const items = data?.items ?? [];
  const totals = items.reduce((t, i) => ({ quantity: t.quantity + i.quantity, vat: t.vat + i.vatAmount, total: t.total + i.lineTotal }), { quantity: 0, vat: 0, total: 0 });

  return (
    <Panel title="Sipariş kalemleri" description={data ? `${items.length} kalem · ${totals.quantity} adet · sipariş anındaki fiyatlar` : undefined} bodyClassName={items.length ? "p-0" : undefined}>
      {error ? <Notice tone="error">{error}</Notice>
        : !data ? <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        : !items.length ? <EmptyState title="Bu siparişte kalem kaydı yok" />
        : (
          <>
            <div className="hidden px-1 pb-1 md:block md:px-2">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Ürün</TableHead><TableHead className="text-right">Adet</TableHead><TableHead className="text-right">Birim fiyat</TableHead>
                  <TableHead className="text-right">KDV</TableHead><TableHead className="text-right">Toplam</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="whitespace-normal">
                        <div className="flex items-center gap-3"><Thumb item={i} /><div className="min-w-0"><p className="font-medium">{i.productName}</p><p className="text-xs text-muted-foreground">{model(i)}</p></div></div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{i.quantity}</TableCell>
                      <TableCell className="text-right tabular-nums">{tryCurrency(i.unitPrice)}</TableCell>
                      <TableCell className="text-right tabular-nums">{tryCurrency(i.vatAmount)}<p className="text-xs text-muted-foreground">{vatRate(i.vatRateBps)}</p></TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{tryCurrency(i.lineTotal)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter><TableRow>
                  <TableCell>Kalemler toplamı</TableCell><TableCell className="text-right tabular-nums">{totals.quantity}</TableCell><TableCell />
                  <TableCell className="text-right tabular-nums">{tryCurrency(totals.vat)}</TableCell><TableCell className="text-right tabular-nums">{tryCurrency(totals.total)}</TableCell>
                </TableRow></TableFooter>
              </Table>
            </div>
            <ul className="divide-y md:hidden">
              {items.map((i) => (
                <li key={i.id} className="flex gap-3 p-4">
                  <Thumb item={i} />
                  <div className="grid min-w-0 flex-1 gap-1 text-sm">
                    <p className="font-medium">{i.productName}</p>
                    <p className="text-xs text-muted-foreground">{model(i)}</p>
                    <p className="text-muted-foreground">{i.quantity} × {tryCurrency(i.unitPrice)} · KDV {tryCurrency(i.vatAmount)} ({vatRate(i.vatRateBps)})</p>
                    <p className="font-semibold tabular-nums">{tryCurrency(i.lineTotal)}</p>
                  </div>
                </li>
              ))}
              <li className="flex justify-between gap-3 p-4 text-sm font-semibold"><span>Kalemler toplamı ({totals.quantity} adet)</span><span className="tabular-nums">{tryCurrency(totals.total)}</span></li>
            </ul>
          </>
        )}
    </Panel>
  );
}
