"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, FormField, Notice, PageHeader, Panel, StatusBadge, selectClass } from "@/components/admin/ui";
import { sendAdmin, useAdminJson, type Overview } from "@/components/admin/use-admin-data";
import { LOW_STOCK_THRESHOLD, stockLabel, stockLevel, stockTone, type StockLevel } from "@/lib/admin-ui";

const saleModeLabel: Record<string, string> = { online: "Online satış", quote: "Teklif", discovery: "Keşif", whatsapp: "WhatsApp", out_of_stock: "Stok dışı" };
const levelOrder: Record<StockLevel, number> = { out: 0, low: 1, ok: 2, untracked: 3 };

/** One product at a time through the existing PATCH /api/admin/products/[id] {stock} - no bulk writes. */
export default function InventoryView({ canWrite }: { canWrite: boolean }) {
  const { data, error, loading, reload } = useAdminJson<Overview>("/api/admin/overview");
  const [filter, setFilter] = useState("alerts");
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    return (data?.products ?? []).map((p) => ({ p, level: stockLevel(p) }))
      .filter(({ p, level }) => (filter === "all" || (filter === "alerts" ? level === "out" || level === "low" : level !== "untracked"))
        && (!q || [p.name, p.sku].some((v) => v?.toLocaleLowerCase("tr").includes(q))))
      .sort((a, b) => levelOrder[a.level] - levelOrder[b.level] || a.p.stock - b.p.stock);
  }, [data, filter, query]);

  async function save(id: string, name: string) {
    const value = Number(drafts[id]);
    if (!Number.isInteger(value) || value < 0) { setMessage({ tone: "error", text: "Stok 0 veya daha büyük bir tam sayı olmalı." }); return; }
    const r = await sendAdmin(`/api/admin/products/${id}`, "PATCH", { stock: value });
    setMessage(r.ok ? { tone: "success", text: `${name} stoğu ${value} adet olarak kaydedildi.` } : { tone: "error", text: r.error || "Stok güncellenemedi." });
    if (r.ok) { setDrafts((d) => { const next = { ...d }; delete next[id]; return next; }); reload(); }
  }

  return (
    <>
      <PageHeader title="Stok Yönetimi" description={`Stok yalnızca online satıştaki yayında ürünler için takip edilir. Az stok eşiği: ${LOW_STOCK_THRESHOLD} adet.`} />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <Panel bodyClassName="p-0">
        <div role="search" className="grid grid-cols-1 gap-3 border-b p-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] sm:p-5">
          <FormField label="Ara" htmlFor="inv-search">
            <div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="inv-search" type="search" placeholder="Ürün adı veya SKU" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
          </FormField>
          <FormField label="Göster" htmlFor="inv-filter">
            <select id="inv-filter" className={selectClass} value={filter} onChange={(e) => setFilter(e.target.value)}><option value="alerts">Stok uyarısı olanlar</option><option value="tracked">Stoğu takip edilenler</option><option value="all">Tüm ürünler</option></select>
          </FormField>
        </div>
        <p className="px-4 pt-3 text-sm text-muted-foreground sm:px-5" aria-live="polite">{loading && !data ? "Yükleniyor…" : `${rows.length} ürün`}</p>
        {data && !rows.length ? (
          <div className="p-4 sm:p-5"><EmptyState title={filter === "alerts" ? "Stok uyarısı yok" : "Ürün bulunamadı"} /></div>
        ) : (
          <div className="px-1 pb-2 sm:px-2">
            <Table>
              <TableHeader><TableRow><TableHead>Ürün</TableHead><TableHead>SKU</TableHead><TableHead>Satış biçimi</TableHead><TableHead>Durum</TableHead><TableHead>Stok</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map(({ p, level }) => {
                  const draft = drafts[p.id];
                  const dirty = draft !== undefined && draft !== String(p.stock);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="max-w-[18rem] whitespace-normal font-medium">{p.name}</TableCell>
                      <TableCell className="text-muted-foreground">{p.sku || "—"}</TableCell>
                      <TableCell>{saleModeLabel[p.saleMode] ?? p.saleMode}</TableCell>
                      <TableCell><StatusBadge tone={stockTone[level]}>{stockLabel[level]}</StatusBadge></TableCell>
                      <TableCell className="min-w-[12rem]">
                        {canWrite ? (
                          <div className="flex items-center gap-2">
                            <label htmlFor={`stock-${p.id}`} className="sr-only">{p.name} stok adedi</label>
                            <Input id={`stock-${p.id}`} type="number" min={0} inputMode="numeric" className="w-24" value={draft ?? String(p.stock)} onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))} />
                            <Button type="button" size="sm" variant={dirty ? "default" : "outline"} disabled={!dirty} onClick={() => save(p.id, p.name)} aria-label={`${p.name} stoğunu kaydet`}>Kaydet</Button>
                          </div>
                        ) : <span className="tabular-nums">{p.stock}</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>
    </>
  );
}
