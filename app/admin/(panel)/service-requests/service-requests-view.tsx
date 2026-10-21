"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, FormField, Notice, PageHeader, Panel, StatusBadge, selectClass } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { sendAdmin, useAdminJson } from "@/components/admin/use-admin-data";
import { serviceStatusLabel, serviceStatusTone, serviceStatuses, trDate } from "@/lib/admin-ui";
import type { ServiceRequestListPage } from "@/lib/service-requests-db";

/** Statuses that close a request; they confirm before saving because they cannot be casually undone. */
const closingStatuses = ["completed", "cancelled"] as const;

/** Every row comes from GET /api/admin/service-requests (P0-A #3), paginated server-side - no 100-row cap. */
export default function ServiceRequestsView({ canWrite }: { canWrite: boolean }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("open");
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; requestNumber: string; status: string } | null>(null);

  const url = useMemo(() => {
    const q = new URLSearchParams();
    if (query.trim()) q.set("q", query.trim());
    q.set("filter", filter);
    q.set("page", String(page));
    return `/api/admin/service-requests?${q}`;
  }, [query, filter, page]);
  const { data, error, loading, reload } = useAdminJson<ServiceRequestListPage>(url);
  const onQueryChange = (v: string) => { setQuery(v); setPage(1); };
  const onFilterChange = (v: string) => { setFilter(v); setPage(1); };

  /**
   * Choosing a status saves it immediately, as before - but a CLOSING status (completed/cancelled) now
   * confirms first and names the request, because it is the only destructive-feeling action this screen has.
   */
  async function updateStatus(id: string, requestNumber: string, status: string) {
    if ((closingStatuses as readonly string[]).includes(status)) return setConfirm({ id, requestNumber, status });
    return applyStatus(id, requestNumber, status);
  }
  async function applyStatus(id: string, requestNumber: string, status: string) {
    const r = await sendAdmin(`/api/admin/service-requests/${id}`, "PATCH", { status });
    if (r.ok) {
      toast.success(`${requestNumber} durumu "${serviceStatusLabel[status]}" olarak güncellendi.`);
      setMessage({ tone: "success", text: `${requestNumber} durumu "${serviceStatusLabel[status]}" olarak güncellendi.` });
    } else {
      toast.error(r.error || "Talep güncellenemedi.");
      setMessage({ tone: "error", text: r.error || "Talep güncellenemedi." });
    }
    reload();
  }

  return (
    <>
      <PageHeader title="Servis & Keşif" description="Servis, bakım ve keşif talepleri." />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <Panel bodyClassName="p-0">
        <div role="search" className="grid grid-cols-1 gap-3 border-b p-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] sm:p-5">
          <FormField label="Ara" htmlFor="sr-search">
            <div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="sr-search" type="search" placeholder="Talep no, müşteri, il veya telefon" className="pl-9" value={query} onChange={(e) => onQueryChange(e.target.value)} /></div>
          </FormField>
          <FormField label="Durum" htmlFor="sr-filter">
            <select id="sr-filter" className={selectClass} value={filter} onChange={(e) => onFilterChange(e.target.value)}>
              <option value="open">Açık talepler</option><option value="all">Tümü</option>{serviceStatuses.map((s) => <option key={s} value={s}>{serviceStatusLabel[s]}</option>)}
            </select>
          </FormField>
        </div>
        <p className="px-4 pt-3 text-sm text-muted-foreground sm:px-5" aria-live="polite">
          {loading && !data ? "Yükleniyor…" : data ? `${data.total} talep${data.pageCount > 1 ? ` · sayfa ${data.page} / ${data.pageCount}` : ""}` : ""}
        </p>
        {data && !data.rows.length ? (
          <div className="p-4 sm:p-5"><EmptyState title="Bu filtrede talep yok" /></div>
        ) : (
          <>
            <div className="px-1 pb-2 sm:px-2">
              <Table>
                <TableHeader><TableRow><TableHead>Talep</TableHead><TableHead>Müşteri</TableHead><TableHead>Tür ve mesaj</TableHead><TableHead>Durum</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(data?.rows ?? []).map((r) => (
                    <TableRow key={r.id} className="align-top">
                      <TableCell><p className="font-medium">{r.requestNumber}</p><p className="text-xs text-muted-foreground">{trDate(r.createdAt, true)}</p></TableCell>
                      <TableCell className="whitespace-normal">{r.name}{r.phone ? <p><a className="text-sm text-primary underline-offset-4 hover:underline" href={`tel:${r.phone}`}>{r.phone}</a></p> : null}{r.email ? <p><a className="text-sm text-primary underline-offset-4 hover:underline" href={`mailto:${r.email}`}>{r.email}</a></p> : null}<p className="text-xs text-muted-foreground">{r.city}</p></TableCell>
                      <TableCell className="max-w-[26rem] min-w-[14rem] whitespace-normal">
                        <p className="font-medium">{r.type}</p>
                        {r.message.length > 140
                          ? <details className="text-sm text-muted-foreground"><summary className="cursor-pointer py-3 text-foreground">{r.message.slice(0, 140)}… <span className="text-primary">devamı</span></summary><p className="whitespace-pre-line">{r.message}</p></details>
                          : <p className="whitespace-pre-line text-sm text-muted-foreground">{r.message}</p>}
                      </TableCell>
                      <TableCell className="min-w-[10rem]">
                        {canWrite ? (
                          <>
                            <label htmlFor={`sr-status-${r.id}`} className="sr-only">{r.requestNumber} durumu</label>
                            <select id={`sr-status-${r.id}`} className={selectClass} value={r.status} onChange={(e) => updateStatus(r.id, r.requestNumber, e.target.value)}>{serviceStatuses.map((s) => <option key={s} value={s}>{serviceStatusLabel[s]}</option>)}</select>
                          </>
                        ) : <StatusBadge tone={serviceStatusTone[r.status] ?? "neutral"}>{serviceStatusLabel[r.status] ?? r.status}</StatusBadge>}
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

      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Talep Durumu Onayı"
        description={confirm ? <span><strong>{confirm.requestNumber}</strong> numaralı talep &quot;{serviceStatusLabel[confirm.status]}&quot; olarak kapatılacak. Devam edilsin mi?</span> : null}
        confirmLabel="Evet, Kaydet"
        cancelLabel="Vazgeç"
        variant={confirm?.status === "cancelled" ? "destructive" : "default"}
        onConfirm={async () => {
          if (!confirm) return;
          setConfirm(null);
          await applyStatus(confirm.id, confirm.requestNumber, confirm.status);
        }}
      />
    </>
  );
}
