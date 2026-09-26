"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, Notice, Panel, selectClass } from "@/components/admin/ui";
import { sendAdmin, type Product, type Taxonomy } from "@/components/admin/use-admin-data";
import { DEFAULT_DELIVERY_CLASS, deliveryClassDescriptions, deliveryClassLabels, deliveryClasses, isDeliveryClass, type DeliveryClass } from "@/lib/delivery-classes";

/** Exactly the POST /api/admin/products body the previous dashboard form sent. */
const empty = { name: "", slug: "", category: "Klima", brandId: null as string | null, categoryId: null as string | null, series: "", sku: "", capacity: "", energyClass: "", wifi: "", price: 0, stock: 0, saleMode: "quote", status: "draft", description: "", imageUrl: "", deliveryClass: DEFAULT_DELIVERY_CLASS as DeliveryClass };
type Form = typeof empty;
const saleModes: [string, string][] = [["quote", "Teklif"], ["online", "Online satış"], ["discovery", "Keşif"], ["whatsapp", "WhatsApp"], ["out_of_stock", "Stok dışı"]];
const textFields: [keyof Form, string, boolean][] = [["name", "Ürün adı", true], ["slug", "URL kısa adı", true], ["category", "Kategori (metin)", true], ["series", "Seri", false], ["sku", "SKU", false], ["capacity", "Kapasite", false], ["energyClass", "Enerji sınıfı", false], ["wifi", "Wi-Fi", false]];

export default function ProductForm({ product, brands, categories }: { product?: Product; brands: Taxonomy[]; categories: Taxonomy[] }) {
  const router = useRouter();
  const editing = !!product;
  const [form, setForm] = useState<Form>(() => product
    ? { name: product.name, slug: product.slug, category: product.category, brandId: product.brandId, categoryId: product.categoryId, series: product.series, sku: product.sku, capacity: product.capacity, energyClass: product.energyClass, wifi: product.wifi, price: product.price, stock: product.stock, saleMode: product.saleMode, deliveryClass: isDeliveryClass(product.deliveryClass) ? product.deliveryClass : DEFAULT_DELIVERY_CLASS, status: product.status, description: product.description, imageUrl: product.imageUrl }
    : empty);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState<{ status: "idle" | "uploading" | "error"; error?: string }>({ status: "idle" });
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMessage({ tone: "info", text: editing ? "Güncelleniyor…" : "Ürün kaydediliyor…" });
    const r = editing ? await sendAdmin(`/api/admin/products/${product!.id}`, "PATCH", form) : await sendAdmin("/api/admin/products", "POST", form);
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error || "Kayıt başarısız.");
      setMessage({ tone: "error", text: r.error || "Kayıt başarısız." });
      return;
    }
    toast.success(editing ? "Değişiklikler kaydedildi." : "Yeni ürün başarıyla eklendi.");
    if (editing) setMessage({ tone: "success", text: "Değişiklikler kaydedildi." });
    else router.push("/admin/products");
  }

  async function confirmArchive() {
    if (!product) return;
    setArchiving(true);
    const r = await sendAdmin(`/api/admin/products/${product.id}`, "DELETE");
    setArchiving(false);
    if (!r.ok) {
      toast.error(r.error || "İşlem başarısız.");
      setMessage({ tone: "error", text: r.error || "İşlem başarısız." });
      return;
    }
    toast.success("Ürün yayından kaldırıldı ve stok dışı yapıldı.");
    router.push("/admin/products");
  }

  async function uploadImage(file: File) {
    if (!product) return;
    setUpload({ status: "uploading" });
    const body = new FormData(); body.append("file", file);
    try {
      const r = await fetch(`/api/admin/products/${product.id}/image`, { method: "POST", body });
      const j = (await r.json().catch(() => ({}))) as { error?: string; imageUrl?: string };
      if (!r.ok || !j.imageUrl) { setUpload({ status: "error", error: j.error || "Görsel yüklenemedi." }); return; }
      set("imageUrl", j.imageUrl); setUpload({ status: "idle" });
    } catch { setUpload({ status: "error", error: "Görsel yüklenemedi." }); }
  }

  return (
    <form onSubmit={submit} className="grid gap-6">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <Panel title="Ürün bilgileri">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {textFields.map(([key, label, required]) => (
            <FormField key={key} label={label} htmlFor={`p-${key}`}>
              <Input id={`p-${key}`} required={required} pattern={key === "slug" ? "[a-z0-9-]+" : undefined} value={String(form[key] ?? "")} onChange={(e) => set(key, e.target.value as never)} />
            </FormField>
          ))}
          <FormField label="Marka" htmlFor="p-brand">
            <select id="p-brand" className={selectClass} value={form.brandId ?? ""} onChange={(e) => set("brandId", e.target.value || null)}>
              <option value="">Seçin</option>{brands.filter((b) => b.active || b.id === form.brandId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </FormField>
          <FormField label="Kategori kaydı" htmlFor="p-category-id">
            <select id="p-category-id" className={selectClass} value={form.categoryId ?? ""} onChange={(e) => set("categoryId", e.target.value || null)}>
              <option value="">Seçin</option>{categories.filter((c) => c.active || c.id === form.categoryId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </FormField>
          <FormField label="Açıklama" htmlFor="p-description" className="sm:col-span-2 xl:col-span-4">
            <Textarea id="p-description" rows={5} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </FormField>
        </div>
      </Panel>

      <Panel title="Satış ve stok">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <FormField label="Fiyat (TL)" htmlFor="p-price"><Input id="p-price" type="number" min={0} inputMode="numeric" value={form.price} onChange={(e) => set("price", Number(e.target.value))} /></FormField>
          <FormField label="Stok (adet)" htmlFor="p-stock"><Input id="p-stock" type="number" min={0} inputMode="numeric" value={form.stock} onChange={(e) => set("stock", Number(e.target.value))} /></FormField>
          <FormField label="Satış biçimi" htmlFor="p-sale-mode" hint="Stok yalnızca online satışta takip edilir.">
            <select id="p-sale-mode" className={selectClass} value={form.saleMode} onChange={(e) => set("saleMode", e.target.value)}>{saleModes.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </FormField>
          <FormField label="Yayın durumu" htmlFor="p-status">
            <select id="p-status" className={selectClass} value={form.status} onChange={(e) => set("status", e.target.value)}><option value="draft">Taslak</option><option value="published">Yayında</option></select>
          </FormField>
        </div>
      </Panel>

      <Panel title="Teslimat">
        <div className="grid max-w-xl gap-4">
          {/* The class is one stored value; the server derives installation, shipping and the service area from it (lib/delivery.ts). Raw enum values are never shown. */}
          <FormField label="Teslimat tipi" htmlFor="p-delivery-class" hint={deliveryClassDescriptions[form.deliveryClass]}>
            <select id="p-delivery-class" className={selectClass} value={form.deliveryClass} onChange={(e) => { if (isDeliveryClass(e.target.value)) set("deliveryClass", e.target.value); }}>
              {deliveryClasses.map((c) => <option key={c} value={c}>{deliveryClassLabels[c]}</option>)}
            </select>
          </FormField>
        </div>
      </Panel>

      <Panel title="Görsel">
        <div className="grid gap-4">
          <FormField label="Görsel URL" htmlFor="p-image"><Input id="p-image" type="url" placeholder="https://..." value={form.imageUrl} onChange={(e) => set("imageUrl", e.target.value)} /></FormField>
          {editing ? (
            <FormField label="Dosyadan yükle" htmlFor="p-image-file" hint="JPEG, PNG, WebP veya AVIF, en fazla 4 MB.">
              <input id="p-image-file" type="file" accept="image/jpeg,image/png,image/webp,image/avif" disabled={upload.status === "uploading"} className="min-h-11 w-full max-w-full min-w-0 text-sm file:mr-3 file:min-h-11 file:rounded-md file:border file:border-input file:bg-white file:px-3 file:text-sm" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadImage(f); }} />
            </FormField>
          ) : <p className="text-sm text-muted-foreground">Dosyadan görsel yükleme, ürün kaydedildikten sonra düzenleme ekranında yapılabilir.</p>}
          {upload.status === "uploading" && <Notice tone="info">Görsel yükleniyor…</Notice>}
          {upload.status === "error" && <Notice tone="error">{upload.error}</Notice>}
        </div>
      </Panel>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>{editing ? "Değişiklikleri kaydet" : "Ürünü kaydet"}</Button>
        {editing && <Button type="button" variant="destructive" onClick={() => setArchiveOpen(true)}>Yayından kaldır</Button>}
      </div>

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Ürünü Yayından Kaldırma Onayı"
        description={
          <span>
            <strong>&quot;{product?.name}&quot;</strong> ürününü yayından kaldırmak ve satış modunu &apos;stok dışı&apos; olarak güncellemek istediğinizden emin misiniz?
            <br />
            <span className="mt-1 block text-xs text-muted-foreground">
              Not: Sipariş ve sepet bütünlüğünü korumak adına kayıt silinmez, güvenli bir şekilde arşivlenir.
            </span>
          </span>
        }
        confirmLabel="Evet, Yayından Kaldır"
        cancelLabel="Vazgeç"
        variant="destructive"
        loading={archiving}
        onConfirm={confirmArchive}
      />
    </form>
  );
}
