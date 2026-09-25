"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, FormField, Notice, PageHeader, Panel, StatusBadge } from "@/components/admin/ui";
import { sendAdmin, useAdminJson, type Taxonomy } from "@/components/admin/use-admin-data";

type Kind = "category" | "brand";
const collator = new Intl.Collator("tr");

function TaxonomyPanel({ kind, items, canWrite, onChanged }: { kind: Kind; items: Taxonomy[]; canWrite: boolean; onChanged: (msg: { tone: "success" | "error"; text: string }) => void }) {
  const [form, setForm] = useState({ name: "", slug: "" });
  const noun = kind === "category" ? "Kategori" : "Marka";

  async function add(e: FormEvent) {
    e.preventDefault();
    const r = await sendAdmin("/api/admin/taxonomy", "POST", { type: kind, ...form });
    if (r.ok) setForm({ name: "", slug: "" });
    onChanged(r.ok ? { tone: "success", text: `${noun} "${form.name}" eklendi.` } : { tone: "error", text: r.error || "Kayıt başarısız." });
  }
  async function toggle(item: Taxonomy) {
    const r = await sendAdmin("/api/admin/taxonomy", "PATCH", { type: kind, id: item.id, active: !item.active });
    onChanged(r.ok ? { tone: "success", text: `${item.name} ${item.active ? "pasifleştirildi" : "etkinleştirildi"}.` } : { tone: "error", text: r.error || "Güncelleme başarısız." });
  }

  const sorted = [...items].sort((a, b) => collator.compare(a.name, b.name));
  return (
    <Panel title={kind === "category" ? "Kategoriler" : "Markalar"} description={`${items.filter((i) => i.active).length} aktif / ${items.length} kayıt`}>
      {canWrite && (
        <form onSubmit={add} className="mb-4 grid grid-cols-1 gap-3 border-b pb-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <FormField label={`${noun} adı`} htmlFor={`${kind}-name`}><Input id={`${kind}-name`} required minLength={2} maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
          <FormField label="URL kısa adı" htmlFor={`${kind}-slug`}><Input id={`${kind}-slug`} required pattern="[a-z0-9-]+" placeholder="url-kisa-adi" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></FormField>
          <Button type="submit">Ekle</Button>
        </form>
      )}
      {sorted.length ? (
        <ul className="divide-y">
          {sorted.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <div className="min-w-0"><p className="font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{item.slug}</p></div>
              <div className="flex items-center gap-3">
                <StatusBadge tone={item.active ? "success" : "neutral"}>{item.active ? "Aktif" : "Pasif"}</StatusBadge>
                {canWrite && <Button type="button" variant="outline" size="sm" onClick={() => toggle(item)} aria-label={`${item.name}: ${item.active ? "pasifleştir" : "etkinleştir"}`}>{item.active ? "Pasifleştir" : "Etkinleştir"}</Button>}
              </div>
            </li>
          ))}
        </ul>
      ) : <EmptyState title={`Henüz ${noun.toLocaleLowerCase("tr")} yok`} />}
    </Panel>
  );
}

export default function TaxonomyView({ canWrite }: { canWrite: boolean }) {
  const { data, error, loading, reload } = useAdminJson<{ brands: Taxonomy[]; categories: Taxonomy[] }>("/api/admin/taxonomy");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const changed = (m: { tone: "success" | "error"; text: string }) => { setMessage(m); reload(); };
  return (
    <>
      <PageHeader title="Kategoriler & Markalar" description="Pasif kayıtlar ürün formlarında seçilemez; mevcut ürün bağlantıları korunur." />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {loading && !data && <Notice tone="info">Yükleniyor…</Notice>}
      {data && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <TaxonomyPanel kind="category" items={data.categories} canWrite={canWrite} onChanged={changed} />
          <TaxonomyPanel kind="brand" items={data.brands} canWrite={canWrite} onChanged={changed} />
        </div>
      )}
    </>
  );
}
