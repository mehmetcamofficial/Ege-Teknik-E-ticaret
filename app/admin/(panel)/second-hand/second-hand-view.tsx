"use client";

import Link from "next/link";
import { toast } from "sonner";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, Notice, PageHeader, Panel, StatusBadge, selectClass } from "@/components/admin/ui";
import { RecordActions } from "@/components/admin/record-actions";
import { sendAdmin, useAdminJson, type Overview, type SecondHand } from "@/components/admin/use-admin-data";
import { publishLabel, publishTone, recordActionUnavailableReason, tryCurrency } from "@/lib/admin-ui";

export default function SecondHandView({ canWrite }: { canWrite: boolean }) {
  const { data, error, loading, reload } = useAdminJson<Overview>("/api/admin/overview");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  /** Same quick status change the previous dashboard offered (e.g. marking an item sold). */
  async function updateStatus(id: string, name: string, status: string) {
    const r = await sendAdmin(`/api/admin/second-hand/${id}`, "PATCH", { status });
    if (r.ok) {
      toast.success(`${name}: "${publishLabel[status]}" olarak güncellendi.`);
      setMessage({ tone: "success", text: `${name}: "${publishLabel[status]}" olarak güncellendi.` });
    } else {
      toast.error(r.error || "Güncelleme başarısız.");
      setMessage({ tone: "error", text: r.error || "Güncelleme başarısız." });
    }
    reload();
  }

  /** Soft archive: the existing DELETE without ?hard, which marks the listing sold and zeroes its stock. */
  async function archive(id: string, name: string) {
    const r = await sendAdmin(`/api/admin/second-hand/${id}`, "DELETE");
    if (r.ok) {
      toast.success(`"${name}" arşivlendi (Satıldı).`);
      setMessage({ tone: "success", text: `"${name}" arşivlendi (Satıldı).` });
    } else {
      toast.error(r.error || "Arşivleme başarısız.");
      setMessage({ tone: "error", text: r.error || "Arşivleme başarısız." });
    }
    reload();
  }
  /** Hard delete (?hard=1). The route refuses with 409 when a reservation references the listing. */
  async function destroy(id: string, name: string) {
    const r = await sendAdmin(`/api/admin/second-hand/${id}?hard=1`, "DELETE");
    if (r.ok) {
      toast.success(`"${name}" kalıcı olarak silindi.`);
      setMessage({ tone: "success", text: `"${name}" kalıcı olarak silindi.` });
    } else {
      toast.error(r.error || recordActionUnavailableReason.secondHandHasReservations);
      setMessage({ tone: "error", text: r.error || recordActionUnavailableReason.secondHandHasReservations });
    }
    reload();
  }

  /** Mirrors lib/admin-ui.ts recordActionsFor("secondHand"): edit (page), archive (soft), delete (hard). */
  function actionsFor(x: SecondHand) {
    return [
      { key: "edit" as const, href: `/admin/second-hand/${x.id}` },
      { key: "archive" as const, onClick: () => void archive(x.id, x.name),
        confirm: { title: "İlanı Arşivleme Onayı", confirmLabel: "Evet, Arşivle",
          description: <span><strong>{x.name}</strong> ilanı arşivlenecek: &quot;Satıldı&quot; olarak işaretlenir ve stoğu sıfırlanır, ancak kayıt veritabanında kalır. Devam edilsin mi?</span> } },
      { key: "delete" as const, onClick: () => void destroy(x.id, x.name),
        confirm: { title: "İlanı Kalıcı Silme Onayı", confirmLabel: "Evet, Kalıcı Sil",
          description: <span><strong>{x.name}</strong> ilanı kalıcı olarak silinecek; bu işlem geri alınamaz. İlana rezervasyon bağlıysa silme engellenir ve &quot;Arşivle&quot; kullanmanız gerekir.</span> } },
    ];
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
              <TableHeader><TableRow><TableHead>İlan</TableHead><TableHead>Kondisyon</TableHead><TableHead className="text-right">Fiyat</TableHead><TableHead className="text-right">Stok</TableHead><TableHead>Durum</TableHead>{canWrite && <TableHead className="text-left">İşlemler</TableHead>}</TableRow></TableHeader>
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
                    {canWrite && <TableCell><RecordActions actions={actionsFor(x)} label={`${x.name} ilan işlemleri`} /></TableCell>}
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
