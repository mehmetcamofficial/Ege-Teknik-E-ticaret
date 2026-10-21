"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, FormField, Notice, PageHeader, Panel, StatusBadge, selectClass } from "@/components/admin/ui";
import { deliveryClassBadge } from "@/lib/delivery-classes";
import { getBlockedProductInfo } from "@/lib/catalog-visibility";
import { sendAdmin, useAdminJson, type Overview, type Product } from "@/components/admin/use-admin-data";
import { RecordActions } from "@/components/admin/record-actions";
import { publishLabel, publishTone, stockLabel, stockLevel, stockTone, tryCurrency } from "@/lib/admin-ui";

const collator = new Intl.Collator("tr");
const visibilityOptions: [string, string][] = [["", "Tümü"], ["blocked", "Müşteriye kapalı"], ["visible", "Müşteriye açık"]];

export default function ProductsView({ canWrite }: { canWrite: boolean }) {
  const { data, error, loading, reload } = useAdminJson<Overview>("/api/admin/overview");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [visibility, setVisibility] = useState("");
  const [message, setMessage] = useState<{ tone: "info" | "success" | "error"; text: string } | null>(null);

  const categories = useMemo(() => [...new Set((data?.products ?? []).map((p) => p.category).filter(Boolean))].sort(collator.compare), [data]);
  const blockedCount = useMemo(() => (data?.products ?? []).filter((p) => getBlockedProductInfo(p.id)).length, [data]);
  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    return (data?.products ?? []).filter((p) => {
      const blocked = getBlockedProductInfo(p.id) !== null;
      return (!category || p.category === category) && (!status || p.status === status)
        && (!visibility || (visibility === "blocked" ? blocked : !blocked))
        && (!q || [p.name, p.sku, p.slug, p.series].some((v) => v?.toLocaleLowerCase("tr").includes(q)));
    });
  }, [data, query, category, status, visibility]);

  async function importCatalog() {
    setMessage({ tone: "info", text: "GREE kataloğu veritabanına aktarılıyor…" });
    const r = await sendAdmin("/api/admin/catalog/import", "POST");
    if (!r.ok) {
      toast.error(r.error || "Katalog aktarılamadı.");
      setMessage({ tone: "error", text: r.error || "Katalog aktarılamadı." });
      return;
    }
    toast.success(`${Number(r.json?.total ?? 0)} katalog kaydı kontrol edildi; ${Number(r.json?.inserted ?? 0)} eksik ürün eklendi.`);
    setMessage({ tone: "success", text: `${Number(r.json?.total ?? 0)} katalog kaydı kontrol edildi; ${Number(r.json?.inserted ?? 0)} eksik ürün eklendi.` });
    reload();
  }

  /**
   * Archive = the EXISTING product DELETE, which is a soft archive (status draft + saleMode out_of_stock
   * + stock 0). There is deliberately no hard-delete endpoint for products, so no "Sil" is offered here.
   */
  async function archive(id: string, name: string) {
    const r = await sendAdmin(`/api/admin/products/${id}`, "DELETE");
    if (r.ok) {
      toast.success(`"${name}" arşivlendi.`);
      setMessage({ tone: "success", text: `"${name}" arşivlendi: taslağa alındı ve stoğu sıfırlandı.` });
    } else {
      toast.error(r.error || "Arşivleme başarısız.");
      setMessage({ tone: "error", text: r.error || "Arşivleme başarısız." });
    }
    reload();
  }

  /** Mirrors lib/admin-ui.ts recordActionsFor("product"): edit + archive, never delete. */
  function actionsFor(p: Product) {
    return [
      { key: "edit" as const, href: `/admin/products/${p.id}` },
      { key: "archive" as const, onClick: () => void archive(p.id, p.name),
        confirm: { title: "Ürünü Arşivleme Onayı", confirmLabel: "Evet, Arşivle",
          description: <span><strong>{p.name}</strong> arşivlenecek: &quot;Taslak&quot; yapılır, satış biçimi &quot;Stok dışı&quot; olur ve stok sıfırlanır. Ürün kaydı ve geçmişi veritabanında korunur; mağazada görünmez olur.</span> } },
    ];
  }

  return (
    <>
      <PageHeader
        title="Ürünler"
        description="Fiyat, stok ve yayın bilgileri doğrudan canlı veritabanında tutulur."
        actions={canWrite ? (
          <>
            <Button type="button" variant="outline" onClick={importCatalog}>GREE kataloğunu yükle</Button>
            <Button asChild><Link href="/admin/products/new"><Plus aria-hidden="true" />Yeni ürün</Link></Button>
          </>
        ) : null}
      />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      <Panel bodyClassName="p-0">
        <div role="search" className="grid grid-cols-1 gap-3 border-b p-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] sm:p-5">
          <FormField label="Ara" htmlFor="product-search">
            <div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="product-search" type="search" placeholder="Ad, SKU veya seri" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
          </FormField>
          <FormField label="Kategori" htmlFor="product-category">
            <select id="product-category" className={selectClass} value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Tümü</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </FormField>
          <FormField label="Yayın durumu" htmlFor="product-status">
            <select id="product-status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Tümü</option><option value="published">Yayında</option><option value="draft">Taslak</option></select>
          </FormField>
          <FormField label="Görünürlük" htmlFor="product-visibility" hint="Katalog incelemesinde engellenen ürünler müşteriye gösterilmez.">
            <select id="product-visibility" className={selectClass} value={visibility} onChange={(e) => setVisibility(e.target.value)}>{visibilityOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </FormField>
        </div>
        <p className="px-4 pt-3 text-sm text-muted-foreground sm:px-5" aria-live="polite">{loading && !data ? "Yükleniyor…" : `${rows.length} / ${data?.products.length ?? 0} ürün${blockedCount ? ` · ${blockedCount} müşteriye kapalı` : ""}`}</p>
        {data && !rows.length ? (
          <div className="p-4 sm:p-5"><EmptyState title={data.products.length ? "Filtreyle eşleşen ürün yok" : "Henüz ürün yok"} description={data.products.length ? "Aramayı veya filtreleri değiştirin." : undefined} /></div>
        ) : (
          <div className="px-1 pb-2 sm:px-2">
            <Table>
              <TableHeader><TableRow><TableHead>Ürün</TableHead><TableHead>Kategori</TableHead><TableHead className="text-right">Fiyat</TableHead><TableHead>Stok</TableHead><TableHead>Durum</TableHead>{canWrite && <TableHead className="sticky right-0 bg-card text-left shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.18)]">İşlemler</TableHead>}</TableRow></TableHeader>
              <TableBody>
                {rows.map((p) => {
                  const level = stockLevel(p);
                  const blocked = getBlockedProductInfo(p.id);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="max-w-[18rem] whitespace-normal"><p className="font-medium">{p.name}</p><p className="text-xs text-muted-foreground">{p.sku || p.slug}</p></TableCell>
                      <TableCell><span>{p.category}</span>{deliveryClassBadge(p.deliveryClass) && <div className="mt-1"><StatusBadge tone={p.deliveryClass === "shippable" ? "info" : "neutral"}>{deliveryClassBadge(p.deliveryClass)}</StatusBadge></div>}</TableCell>
                      <TableCell className="text-right tabular-nums">{tryCurrency(p.price)}</TableCell>
                      <TableCell><div className="flex items-center gap-2"><span className="tabular-nums">{p.stock}</span>{level !== "untracked" && <StatusBadge tone={stockTone[level]}>{stockLabel[level]}</StatusBadge>}</div></TableCell>
                      <TableCell className="max-w-[16rem] whitespace-normal">
                        <div className="flex flex-wrap items-center gap-1">
                          <StatusBadge tone={publishTone[p.status] ?? "neutral"}>{publishLabel[p.status] ?? p.status}</StatusBadge>
                          {blocked && <StatusBadge tone="danger">Müşteriye kapalı</StatusBadge>}
                        </div>
                        {blocked && <p className="mt-1 text-xs text-muted-foreground">{blocked.reasons.join("; ")}</p>}
                      </TableCell>
                      {canWrite && <TableCell className="sticky right-0 bg-card shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.18)]"><RecordActions actions={actionsFor(p)} label={`${p.name} ürün işlemleri`} /></TableCell>}
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
