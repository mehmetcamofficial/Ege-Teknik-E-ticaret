"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, Notice, Panel, selectClass } from "@/components/admin/ui";
import { sendAdmin, type Product, type Taxonomy } from "@/components/admin/use-admin-data";

/** Exactly the POST /api/admin/products body the previous dashboard form sent. */
const empty = { name: "", slug: "", category: "Klima", brandId: null as string | null, categoryId: null as string | null, series: "", sku: "", capacity: "", energyClass: "", wifi: "", price: 0, stock: 0, saleMode: "quote", status: "draft", description: "", imageUrl: "" };
type Form = typeof empty;
const saleModes: [string, string][] = [["quote", "Teklif"], ["online", "Online satış"], ["discovery", "Keşif"], ["whatsapp", "WhatsApp"], ["out_of_stock", "Stok dışı"]];
const textFields: [keyof Form, string, boolean][] = [["name", "Ürün adı", true], ["slug", "URL kısa adı", true], ["category", "Kategori (metin)", true], ["series", "Seri", false], ["sku", "SKU", false], ["capacity", "Kapasite", false], ["energyClass", "Enerji sınıfı", false], ["wifi", "Wi-Fi", false]];

export default function ProductForm({ product, brands, categories }: { product?: Product; brands: Taxonomy[]; categories: Taxonomy[] }) {
  const router = useRouter();
  const editing = !!product;
  const [form, setForm] = useState<Form>(() => product
    ? { name: product.name, slug: product.slug, category: product.category, brandId: product.brandId, categoryId: product.categoryId, series: product.series, sku: product.sku, capacity: product.capacity, energyClass: product.energyClass, wifi: product.wifi, price: product.price, stock: product.stock, saleMode: product.saleMode, status: product.status, description: product.description, imageUrl: product.imageUrl }
    : empty);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState<{ status: "idle" | "uploading" | "error"; error?: string }>({ status: "idle" });
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMessage({ tone: "info", text: editing ? "Güncelleniyor…" : "Ürün kaydediliyor…" });
    const r = editing ? await sendAdmin(`/api/admin/products/${product!.id}`, "PATCH", form) : await sendAdmin("/api/admin/products", "POST", form);
    setBusy(false);
    if (!r.ok) { setMessage({ tone: "error", text: r.error || "Kayıt başarısız." }); return; }
    if (editing) setMessage({ tone: "success", text: "Değişiklikler kaydedildi." });
    else router.push("/admin/products");
  }

  async function archive() {
    if (!product || !confirm("Ürün yayından kaldırılıp stok dışı yapılsın mı?")) return;
    const r = await sendAdmin(`/api/admin/products/${product.id}`, "DELETE");
    if (!r.ok) { setMessage({ tone: "error", text: r.error || "İşlem başarısız." }); return; }
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
        {editing && <Button type="button" variant="destructive" onClick={archive}>Yayından kaldır</Button>}
      </div>
    </form>
  );
}
