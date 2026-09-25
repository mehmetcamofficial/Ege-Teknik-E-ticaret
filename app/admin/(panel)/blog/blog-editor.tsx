"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, FormField, Notice, PageHeader, Panel, selectClass } from "@/components/admin/ui";
import { sendAdmin, useAdminJson, type Overview, type Post } from "@/components/admin/use-admin-data";

/** Matches app/api/admin/blog/schema.ts (POST full, PATCH partial). */
const empty = { title: "", slug: "", excerpt: "", content: "", imageUrl: "", status: "draft" };
type Form = typeof empty;
const crumbs = [{ href: "/admin/blog", label: "Blog" }];

function BlogForm({ post }: { post?: Post }) {
  const router = useRouter();
  const [form, setForm] = useState<Form>(() => post ? { title: post.title, slug: post.slug, excerpt: post.excerpt, content: post.content, imageUrl: post.imageUrl, status: post.status } : empty);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage({ tone: "info", text: "Kaydediliyor…" });
    const r = post ? await sendAdmin(`/api/admin/blog/${post.id}`, "PATCH", form) : await sendAdmin("/api/admin/blog", "POST", form);
    if (!r.ok) {
      toast.error(r.error || "Yazı kaydedilemedi.");
      setMessage({ tone: "error", text: r.error || "Yazı kaydedilemedi." });
      return;
    }
    toast.success(post ? "Değişiklikler kaydedildi." : "Yazı başarıyla eklendi.");
    if (post) setMessage({ tone: "success", text: "Değişiklikler kaydedildi." });
    else router.push("/admin/blog");
  }

  async function confirmDelete() {
    if (!post) return;
    setDeleting(true);
    const r = await sendAdmin(`/api/admin/blog/${post.id}?hard=1`, "DELETE");
    setDeleting(false);
    if (!r.ok) {
      toast.error(r.error || "Silme işlemi başarısız.");
      setMessage({ tone: "error", text: r.error || "Silme işlemi başarısız." });
      return;
    }
    toast.success("Blog yazısı silindi.");
    router.push("/admin/blog");
  }

  return (
    <form onSubmit={submit} className="grid gap-6">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <Panel>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Başlık" htmlFor="b-title"><Input id="b-title" required minLength={3} maxLength={180} value={form.title} onChange={(e) => set("title", e.target.value)} /></FormField>
          <FormField label="URL kısa adı" htmlFor="b-slug" hint="Yalnızca küçük harf, rakam ve tire."><Input id="b-slug" required pattern="[a-z0-9-]+" value={form.slug} onChange={(e) => set("slug", e.target.value)} /></FormField>
          <FormField label="Özet" htmlFor="b-excerpt" className="sm:col-span-2"><Textarea id="b-excerpt" rows={3} maxLength={500} value={form.excerpt} onChange={(e) => set("excerpt", e.target.value)} /></FormField>
          <FormField label="Yazı içeriği" htmlFor="b-content" className="sm:col-span-2" hint="Boş satırlar paragrafları ayırır. En az 20 karakter."><Textarea id="b-content" required minLength={20} rows={14} className="min-h-72" value={form.content} onChange={(e) => set("content", e.target.value)} /></FormField>
          <FormField label="Görsel URL" htmlFor="b-image"><Input id="b-image" type="url" placeholder="https://..." value={form.imageUrl} onChange={(e) => set("imageUrl", e.target.value)} /></FormField>
          <FormField label="Durum" htmlFor="b-status"><select id="b-status" className={selectClass} value={form.status} onChange={(e) => set("status", e.target.value)}><option value="draft">Taslak</option><option value="published">Yayında</option></select></FormField>
        </div>
      </Panel>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit">{post ? "Değişiklikleri kaydet" : "Yazıyı kaydet"}</Button>
        {post && <Button type="button" variant="destructive" onClick={() => setDeleteOpen(true)}>Yazıyı sil</Button>}
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Blog Yazısını Silme Onayı"
        description={
          <span>
            <strong>&quot;{post?.title}&quot;</strong> başlıklı blog yazısını kalıcı olarak silmek istediğinizden emin misiniz?
            <br />
            <span className="mt-1 block text-xs text-muted-foreground">
              Not: Bu işlem geri alınamaz.
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

export default function BlogEditor({ postId }: { postId?: string }) {
  const { data, error, loading } = useAdminJson<Overview>(postId ? "/api/admin/overview" : null);
  const post = postId ? data?.posts.find((p) => p.id === postId) : undefined;
  return (
    <>
      <PageHeader title={postId ? (post?.title ?? "Yazıyı düzenle") : "Yeni blog yazısı"} breadcrumb={crumbs} />
      {!postId ? <BlogForm /> : (
        <>
          {error && <Notice tone="error">{error}</Notice>}
          {loading && !data && <Notice tone="info">Yükleniyor…</Notice>}
          {data && !post && <EmptyState title="Yazı bulunamadı" />}
          {post && <BlogForm key={post.id} post={post} />}
        </>
      )}
    </>
  );
}
