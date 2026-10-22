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
const empty = { name: "", slug: "", category: "Klima", condition: "İyi", testNotes: "", warranty: "", price: 0, stock: 1, imageUrl: "", status: "draft", description: "",
  inspectionDate: "", inspectionResult: "", coolingTest: "", heatingTest: "", conditionGrade: "", knownDefects: "", missingAccessories: "", warrantyMonths: 0 };
type Form = typeof empty;
const crumbs = [{ href: "/admin/second-hand", label: "İkinci El / Outlet" }];

function SecondHandForm({ item }: { item?: SecondHand }) {
  const router = useRouter();
  const [form, setForm] = useState<Form>(() => item ? { name: item.name, slug: item.slug, category: item.category, condition: item.condition, testNotes: item.testNotes, warranty: item.warranty, price: item.price, stock: item.stock, imageUrl: item.imageUrl, status: item.status, description: item.description,
    inspectionDate: (item as { inspectionDate?: string | null }).inspectionDate ?? "", inspectionResult: (item as { inspectionResult?: string | null }).inspectionResult ?? "",
    coolingTest: (item as { coolingTest?: string | null }).coolingTest ?? "", heatingTest: (item as { heatingTest?: string | null }).heatingTest ?? "",
    conditionGrade: (item as { conditionGrade?: string | null }).conditionGrade ?? "", knownDefects: (item as { knownDefects?: string }).knownDefects ?? "",
    missingAccessories: (item as { missingAccessories?: string }).missingAccessories ?? "", warrantyMonths: (item as { warrantyMonths?: number }).warrantyMonths ?? 0 } : empty);
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
      <Panel title="Teknik kontrol ve kondisyon (yayın için zorunlu)">
        <p className="mb-4 text-sm text-muted-foreground">Taslak eksik bilgiyle kaydedilebilir; ancak kontrol tarihi + sonucu, soğutma/ısıtma testi ve kondisyon derecesi tamamlanmadan ürün <strong>Yayında</strong> durumuna geçirilemez. Bilinen kusur ve eksik aksesuar müşteri vitrininde aynen gösterilir.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <FormField label="Teknik kontrol tarihi" htmlFor="sh-insp-date"><Input id="sh-insp-date" type="date" value={form.inspectionDate} onChange={(e) => set("inspectionDate", e.target.value)} /></FormField>
          <FormField label="Soğutma testi" htmlFor="sh-cool">
            <select id="sh-cool" className={selectClass} value={form.coolingTest} onChange={(e) => set("coolingTest", e.target.value)}><option value="">Seçilmedi</option><option value="passed">Geçti</option><option value="not_tested">Henüz yapılmadı</option><option value="failed">Geçemedi</option></select>
          </FormField>
          <FormField label="Isıtma testi" htmlFor="sh-heat">
            <select id="sh-heat" className={selectClass} value={form.heatingTest} onChange={(e) => set("heatingTest", e.target.value)}><option value="">Seçilmedi</option><option value="passed">Geçti</option><option value="not_tested">Henüz yapılmadı</option><option value="failed">Geçemedi</option></select>
          </FormField>
          <FormField label="Kondisyon derecesi" htmlFor="sh-grade">
            <select id="sh-grade" className={selectClass} value={form.conditionGrade} onChange={(e) => set("conditionGrade", e.target.value)}><option value="">Seçilmedi</option><option value="cok_iyi">Çok iyi</option><option value="iyi">İyi</option><option value="orta">Orta</option><option value="yedek_parca">Yedek parça / çalışmıyor</option></select>
          </FormField>
          <FormField label="Teknik kontrol sonucu" htmlFor="sh-insp-result" className="sm:col-span-2 xl:col-span-4"><Textarea id="sh-insp-result" rows={3} value={form.inspectionResult} onChange={(e) => set("inspectionResult", e.target.value)} /></FormField>
          <FormField label="Bilinen kusurlar" htmlFor="sh-defects" className="sm:col-span-2"><Textarea id="sh-defects" rows={3} placeholder="Yoksa boş bırakın" value={form.knownDefects} onChange={(e) => set("knownDefects", e.target.value)} /></FormField>
          <FormField label="Eksik aksesuarlar" htmlFor="sh-missing" className="sm:col-span-2"><Textarea id="sh-missing" rows={3} placeholder="Tamamsa boş bırakın" value={form.missingAccessories} onChange={(e) => set("missingAccessories", e.target.value)} /></FormField>
          <FormField label="Ek ticari garanti (ay)" htmlFor="sh-wmonths" hint="0 = ek garanti yok; kanuni haklar her durumda saklıdır"><Input id="sh-wmonths" type="number" min={0} max={120} inputMode="numeric" value={form.warrantyMonths} onChange={(e) => set("warrantyMonths", Number(e.target.value))} /></FormField>
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
