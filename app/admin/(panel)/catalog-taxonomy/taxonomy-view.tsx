"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { RecordActions } from "@/components/admin/record-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, FormField, Notice, PageHeader, Panel, StatusBadge } from "@/components/admin/ui";
import { sendAdmin, useAdminJson, type Taxonomy } from "@/components/admin/use-admin-data";
import { recordActionUnavailableReason } from "@/lib/admin-ui";

type Kind = "category" | "brand";
const collator = new Intl.Collator("tr");

function TaxonomyPanel({ kind, items, canWrite, onChanged }: { kind: Kind; items: Taxonomy[]; canWrite: boolean; onChanged: (msg?: { tone: "success" | "error"; text: string }) => void }) {
  const [form, setForm] = useState({ name: "", slug: "" });
  const [edits, setEdits] = useState<Record<string, { name: string; slug: string }>>({});
  const noun = kind === "category" ? "Kategori" : "Marka";

  async function add(e: FormEvent) {
    e.preventDefault();
    const r = await sendAdmin("/api/admin/taxonomy", "POST", { type: kind, ...form });
    if (r.ok) {
      toast.success(`${noun} "${form.name}" eklendi.`);
      setForm({ name: "", slug: "" });
      onChanged();
    } else {
      toast.error(r.error || "Kayıt başarısız.");
      onChanged({ tone: "error", text: r.error || "Kayıt başarısız." });
    }
  }
  async function toggle(item: Taxonomy) {
    const next = !item.active;
    const r = await sendAdmin("/api/admin/taxonomy", "PATCH", { type: kind, id: item.id, active: next });
    if (r.ok) {
      toast.success(`${item.name} ${next ? "etkinleştirildi" : "pasifleştirildi"}.`);
      onChanged();
    } else {
      toast.error(r.error || "Güncelleme başarısız.");
      onChanged({ tone: "error", text: r.error || "Güncelleme başarısız." });
    }
  }
  /** Rename through the same PATCH; `editing` holds the in-progress values so the row becomes a small form. */
  async function saveRename(item: Taxonomy) {
    const draft = edits[item.id];
    if (!draft) return;
    const name = draft.name.trim(), slug = draft.slug.trim();
    if (name.length < 2 || !/^[a-z0-9-]+$/.test(slug)) {
      toast.error("Ad en az 2 karakter, URL kısa adı ise yalnızca küçük harf, rakam ve tire içerebilir.");
      return;
    }
    const r = await sendAdmin("/api/admin/taxonomy", "PATCH", { type: kind, id: item.id, name, slug });
    if (r.ok) {
      toast.success(`${noun} "${name}" güncellendi.`);
      setEdits((e) => { const next = { ...e }; delete next[item.id]; return next; });
      onChanged();
    } else {
      toast.error(r.error || "Güncelleme başarısız.");
      onChanged({ tone: "error", text: r.error || "Güncelleme başarısız." });
    }
  }

  const actionsFor = (item: Taxonomy) => [
    { key: "edit" as const, onClick: () => setEdits((e) => ({ ...e, [item.id]: { name: item.name, slug: item.slug } })),
      confirm: { title: `${noun} Düzenleme Onayı`, confirmLabel: "Evet, Kaydet",
        description: <span><strong>{item.name}</strong> {noun.toLocaleLowerCase("tr")} yeniden adlandırılacak. URL kısa adı değişirse eski bağlantılar çalışmaz.</span> } },
    { key: "delete" as const, onClick: () => void confirmDelete(item),
      confirm: { title: `${noun} Silme Onayı`, confirmLabel: "Evet, Sil",
        description: <span><strong>{item.name}</strong> {noun.toLocaleLowerCase("tr")} kalıcı olarak silinecek. Bağlı ürünleri varsa silme engellenir; o durumda &quot;Pasifleştir&quot; kullanın.</span> } },
  ];

  /** The delete confirmation lives in RecordActions, so this runs the already-confirmed deletion. */
  async function confirmDelete(item: Taxonomy) {
    const r = await sendAdmin("/api/admin/taxonomy", "DELETE", { type: kind, id: item.id });
    if (r.ok) {
      toast.success(`${noun} "${item.name}" silindi.`);
      onChanged();
    } else {
      toast.error(r.error || recordActionUnavailableReason.taxonomyInUse);
      onChanged({ tone: "error", text: r.error || recordActionUnavailableReason.taxonomyInUse });
    }
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
          {sorted.map((item) => {
            const edit = edits[item.id];
            return (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                {edit ? (
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <label htmlFor={`${kind}-edit-name-${item.id}`} className="sr-only">{item.name} yeni adı</label>
                    <Input id={`${kind}-edit-name-${item.id}`} value={edit.name} onChange={(e) => setEdits((s) => ({ ...s, [item.id]: { ...edit, name: e.target.value } }))} />
                    <label htmlFor={`${kind}-edit-slug-${item.id}`} className="sr-only">{item.name} yeni URL kısa adı</label>
                    <Input id={`${kind}-edit-slug-${item.id}`} value={edit.slug} onChange={(e) => setEdits((s) => ({ ...s, [item.id]: { ...edit, slug: e.target.value } }))} />
                  </div>
                ) : (
                  <><p className="font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{item.slug}</p></>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {edit ? (
                  <>
                    <Button type="button" size="sm" onClick={() => void saveRename(item)}>Kaydet</Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setEdits((s) => { const n = { ...s }; delete n[item.id]; return n; })}>Vazgeç</Button>
                  </>
                ) : (
                  <>
                    <StatusBadge tone={item.active ? "success" : "neutral"}>{item.active ? "Aktif" : "Pasif"}</StatusBadge>
                    {canWrite && <Button type="button" variant="outline" size="sm" onClick={() => void toggle(item)} aria-label={`${item.name}: ${item.active ? "pasifleştir" : "etkinleştir"}`}>{item.active ? "Pasifleştir" : "Etkinleştir"}</Button>}
                    {canWrite && <RecordActions actions={actionsFor(item)} label={`${item.name} ${noun.toLocaleLowerCase("tr")} işlemleri`} />}
                  </>
                )}
              </div>
            </li>
            );
          })}
        </ul>
      ) : <EmptyState title={`Henüz ${noun.toLocaleLowerCase("tr")} yok`} />}

    </Panel>
  );
}

export default function TaxonomyView({ canWrite }: { canWrite: boolean }) {
  const { data, error, loading, reload } = useAdminJson<{ brands: Taxonomy[]; categories: Taxonomy[] }>("/api/admin/taxonomy");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const changed = (m?: { tone: "success" | "error"; text: string }) => { if (m) setMessage(m); reload(); };
  return (
    <>
      <PageHeader title="Kategoriler & Markalar" description="Pasif kayıtlar ürün formlarında seçilemez; mevcut ürün bağlantıları korunur. Bağlantısız kayıtlar güvenle silinebilir." />
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
