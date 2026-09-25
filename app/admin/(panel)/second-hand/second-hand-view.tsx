"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, Notice, PageHeader, Panel, StatusBadge, selectClass } from "@/components/admin/ui";
import { sendAdmin, useAdminJson, type Overview } from "@/components/admin/use-admin-data";
import { publishLabel, publishTone, tryCurrency } from "@/lib/admin-ui";

export default function SecondHandView({ canWrite }: { canWrite: boolean }) {
  const { data, error, loading, reload } = useAdminJson<Overview>("/api/admin/overview");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  /** Same quick status change the previous dashboard offered (e.g. marking an item sold). */
  async function updateStatus(id: string, name: string, status: string) {
    const r = await sendAdmin(`/api/admin/second-hand/${id}`, "PATCH", { status });
    setMessage(r.ok ? { tone: "success", text: `${name}: "${publishLabel[status]}" olarak güncellendi.` } : { tone: "error", text: r.error || "Güncelleme başarısız." });
    reload();
  }

  return (
    <>
      <PageHeader title="İkinci El / Outlet" description="Test edilmiş ikinci el ve outlet stokları." actions={canWrite ? <Button asChild><Link href="/admin/second-hand/new"><Plus aria-hidden="true" />Yeni ilan</Link></Button> : null} />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <Panel bodyClassName="p-0">
        {loading && !data ? <p className="p-5 text-sm text-muted-foreground">Yükleniyor…</p> : data && !data.secondHand.length ? (
          <div className="p-4 sm:p-5"><EmptyState title="Henüz ikinci el ilanı yok" action={canWrite ? <Button asChild variant="outline"><Link href="/admin/second-hand/new">İlk ilanı ekle</Link></Button> : undefined} /></div>
        ) : (
          <div className="px-1 py-2 sm:px-2">
            <Table>
              <TableHeader><TableRow><TableHead>İlan</TableHead><TableHead>Kondisyon</TableHead><TableHead className="text-right">Fiyat</TableHead><TableHead className="text-right">Stok</TableHead><TableHead>Durum</TableHead>{canWrite && <TableHead><span className="sr-only">İşlem</span></TableHead>}</TableRow></TableHeader>
              <TableBody>
                {data?.secondHand.map((x) => (
                  <TableRow key={x.id}>
                    <TableCell className="max-w-[18rem] whitespace-normal"><p className="font-medium">{x.name}</p><p className="text-xs text-muted-foreground">{x.category}</p></TableCell>
                    <TableCell>{x.condition}</TableCell>
                    <TableCell className="text-right tabular-nums">{tryCurrency(x.price)}</TableCell>
                    <TableCell className="text-right tabular-nums">{x.stock}</TableCell>
                    <TableCell className="min-w-[9rem]">
                      {canWrite ? (
                        <><label htmlFor={`sh-status-${x.id}`} className="sr-only">{x.name} durumu</label>
                          <select id={`sh-status-${x.id}`} className={selectClass} value={x.status} onChange={(e) => updateStatus(x.id, x.name, e.target.value)}><option value="draft">Taslak</option><option value="published">Yayında</option><option value="sold">Satıldı</option></select></>
                      ) : <StatusBadge tone={publishTone[x.status] ?? "neutral"}>{publishLabel[x.status] ?? x.status}</StatusBadge>}
                    </TableCell>
                    {canWrite && <TableCell className="text-right"><Button asChild variant="outline" size="sm"><Link href={`/admin/second-hand/${x.id}`} aria-label={`${x.name} ilanını düzenle`}>Düzenle</Link></Button></TableCell>}
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
