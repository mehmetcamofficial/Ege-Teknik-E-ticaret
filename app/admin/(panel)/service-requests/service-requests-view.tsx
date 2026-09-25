"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, FormField, Notice, PageHeader, Panel, StatusBadge, selectClass } from "@/components/admin/ui";
import { sendAdmin, useAdminJson, type Overview } from "@/components/admin/use-admin-data";
import { OPEN_SERVICE_STATUSES, serviceStatusLabel, serviceStatusTone, serviceStatuses, trDate } from "@/lib/admin-ui";

export default function ServiceRequestsView({ canWrite }: { canWrite: boolean }) {
  const { data, error, loading, reload } = useAdminJson<Overview>("/api/admin/overview");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("open");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    return (data?.requests ?? []).filter((r) => (filter === "all" || (filter === "open" ? (OPEN_SERVICE_STATUSES as readonly string[]).includes(r.status) : r.status === filter))
      && (!q || [r.requestNumber, r.name, r.city, r.type, r.phone].some((v) => v?.toLocaleLowerCase("tr").includes(q))));
  }, [data, query, filter]);

  /** Same behaviour as before the redesign: choosing a status saves it immediately. */
  async function updateStatus(id: string, requestNumber: string, status: string) {
    const r = await sendAdmin(`/api/admin/service-requests/${id}`, "PATCH", { status });
    setMessage(r.ok ? { tone: "success", text: `${requestNumber} durumu "${serviceStatusLabel[status]}" olarak güncellendi.` } : { tone: "error", text: r.error || "Talep güncellenemedi." });
    reload();
  }

  return (
    <>
      <PageHeader title="Servis & Keşif" description={data && data.requests.length >= 100 ? "En son 100 talep gösteriliyor." : "Servis, bakım ve keşif talepleri."} />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <Panel bodyClassName="p-0">
        <div role="search" className="grid grid-cols-1 gap-3 border-b p-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] sm:p-5">
          <FormField label="Ara" htmlFor="sr-search">
            <div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="sr-search" type="search" placeholder="Talep no, müşteri, il veya telefon" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
          </FormField>
          <FormField label="Durum" htmlFor="sr-filter">
            <select id="sr-filter" className={selectClass} value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="open">Açık talepler</option><option value="all">Tümü</option>{serviceStatuses.map((s) => <option key={s} value={s}>{serviceStatusLabel[s]}</option>)}
            </select>
          </FormField>
        </div>
        <p className="px-4 pt-3 text-sm text-muted-foreground sm:px-5" aria-live="polite">{loading && !data ? "Yükleniyor…" : `${rows.length} talep`}</p>
        {data && !rows.length ? (
          <div className="p-4 sm:p-5"><EmptyState title="Bu filtrede talep yok" /></div>
        ) : (
          <div className="px-1 pb-2 sm:px-2">
            <Table>
              <TableHeader><TableRow><TableHead>Talep</TableHead><TableHead>Müşteri</TableHead><TableHead>Tür ve mesaj</TableHead><TableHead>Durum</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className="align-top">
                    <TableCell><p className="font-medium">{r.requestNumber}</p><p className="text-xs text-muted-foreground">{trDate(r.createdAt, true)}</p></TableCell>
                    <TableCell className="whitespace-normal">{r.name}<p><a className="text-sm text-primary underline-offset-4 hover:underline" href={`tel:${r.phone}`}>{r.phone}</a></p><p className="text-xs text-muted-foreground">{r.city}</p></TableCell>
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
        )}
      </Panel>
    </>
  );
}
