"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, FormField, Notice, PageHeader, Panel, selectClass } from "@/components/admin/ui";
import { sendAdmin, useAdminJson, type Overview, type SecondHand } from "@/components/admin/use-admin-data";

/** Matches app/api/admin/second-hand/schema.ts (POST full, PATCH partial). */
const empty = { name: "", slug: "", category: "Klima", condition: "İyi", testNotes: "", warranty: "", price: 0, stock: 1, imageUrl: "", status: "draft", description: "" };
type Form = typeof empty;
const crumbs = [{ href: "/admin/second-hand", label: "İkinci El / Outlet" }];

function SecondHandForm({ item }: { item?: SecondHand }) {
  const router = useRouter();
  const [form, setForm] = useState<Form>(() => item ? { name: item.name, slug: item.slug, category: item.category, condition: item.condition, testNotes: item.testNotes, warranty: item.warranty, price: item.price, stock: item.stock, imageUrl: item.imageUrl, status: item.status, description: item.description } : empty);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage({ tone: "info", text: "Kaydediliyor…" });
    const r = item ? await sendAdmin(`/api/admin/second-hand/${item.id}`, "PATCH", form) : await sendAdmin("/api/admin/second-hand", "POST", form);
    if (!r.ok) {
      toast.error(r.error || "Kayıt başarısız.");
      setMessage({ tone: "error", text: r.error || "Kayıt başarısız." });
      return;
    }
    toast.success(item ? "Değişiklikler kaydedildi." : "İkinci el ilanı başarıyla oluşturuldu.");
    if (item) setMessage({ tone: "success", text: "Değişiklikler kaydedildi." });
    else router.push("/admin/second-hand");
  }

  async function confirmDelete() {
    if (!item) return;
    setDeleting(true);
    const r = await sendAdmin(`/api/admin/second-hand/${item.id}?hard=1`, "DELETE");
    setDeleting(false);
    if (!r.ok) {
      toast.error(r.error || "Silme işlemi başarısız.");
      setMessage({ tone: "error", text: r.error || "Silme işlemi başarısız." });
      return;
    }
    toast.success("İkinci el ilanı kalıcı olarak silindi.");
    router.push("/admin/second-hand");
  }

  const text: [keyof Form, string, boolean][] = [["name", "Ad", true], ["slug", "URL kısa adı", true], ["category", "Kategori", true], ["condition", "Kondisyon", false], ["warranty", "Garanti", false]];
  return (
    <form onSubmit={submit} className="grid gap-6">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <Panel title="İlan bilgileri">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {text.map(([k, label, required]) => (
            <FormField key={k} label={label} htmlFor={`sh-${k}`}><Input id={`sh-${k}`} required={required} pattern={k === "slug" ? "[a-z0-9-]+" : undefined} value={String(form[k])} onChange={(e) => set(k, e.target.value as never)} /></FormField>
          ))}
          <FormField label="Fiyat (TL)" htmlFor="sh-price"><Input id="sh-price" type="number" min={0} inputMode="numeric" value={form.price} onChange={(e) => set("price", Number(e.target.value))} /></FormField>
          <FormField label="Stok (adet)" htmlFor="sh-stock" hint="0–99"><Input id="sh-stock" type="number" min={0} max={99} inputMode="numeric" value={form.stock} onChange={(e) => set("stock", Number(e.target.value))} /></FormField>
          <FormField label="Durum" htmlFor="sh-status">
            <select id="sh-status" className={selectClass} value={form.status} onChange={(e) => set("status", e.target.value)}><option value="draft">Taslak</option><option value="published">Yayında</option><option value="sold">Satıldı</option></select>
          </FormField>
          <FormField label="Görsel URL" htmlFor="sh-image" className="sm:col-span-2 xl:col-span-4"><Input id="sh-image" type="url" placeholder="https://..." value={form.imageUrl} onChange={(e) => set("imageUrl", e.target.value)} /></FormField>
          <FormField label="Test notları" htmlFor="sh-test" className="sm:col-span-2"><Textarea id="sh-test" rows={4} value={form.testNotes} onChange={(e) => set("testNotes", e.target.value)} /></FormField>
          <FormField label="Açıklama" htmlFor="sh-desc" className="sm:col-span-2"><Textarea id="sh-desc" rows={4} value={form.description} onChange={(e) => set("description", e.target.value)} /></FormField>
        </div>
      </Panel>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit">{item ? "Değişiklikleri kaydet" : "İlanı kaydet"}</Button>
        {item && <Button type="button" variant="destructive" onClick={() => setDeleteOpen(true)}>İlanı sil</Button>}
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="İkinci El İlanı Silme Onayı"
        description={
          <span>
            <strong>&quot;{item?.name}&quot;</strong> ilanını kalıcı olarak silmek istediğinizden emin misiniz?
            <br />
            <span className="mt-1 block text-xs text-muted-foreground">
              Not: İlana ait müşteri rezervasyon geçmişi varsa veri bütünlüğü için silme işlemi engellenecektir.
            </span>
          </span>
        }
        confirmLabel="Evet, Sil"
        cancelLabel="Vazgeç"
        variant="destructive"
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </form>
  );
}

export default function SecondHandEditor({ itemId }: { itemId?: string }) {
  const { data, error, loading } = useAdminJson<Overview>(itemId ? "/api/admin/overview" : null);
  const item = itemId ? data?.secondHand.find((x) => x.id === itemId) : undefined;
  return (
    <>
      <PageHeader title={itemId ? (item?.name ?? "İlanı düzenle") : "Yeni ikinci el ilanı"} breadcrumb={crumbs} />
      {!itemId ? <SecondHandForm /> : (
        <>
          {error && <Notice tone="error">{error}</Notice>}
          {loading && !data && <Notice tone="info">Yükleniyor…</Notice>}
          {data && !item && <EmptyState title="İlan bulunamadı" />}
          {item && <SecondHandForm key={item.id} item={item} />}
        </>
      )}
    </>
  );
}
