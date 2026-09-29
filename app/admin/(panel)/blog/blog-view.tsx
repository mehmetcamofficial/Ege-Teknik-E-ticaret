"use client";

import Link from "next/link";
import { toast } from "sonner";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, Notice, PageHeader, Panel, StatusBadge, selectClass } from "@/components/admin/ui";
import { sendAdmin, useAdminJson } from "@/components/admin/use-admin-data";
import { publishLabel, publishTone, trDate } from "@/lib/admin-ui";
import type { BlogListPage } from "@/lib/blog-db";

/** Every row comes from GET /api/admin/blog (P0-A #3), paginated server-side - no 100-row cap. */
export default function BlogView({ canWrite }: { canWrite: boolean }) {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useAdminJson<BlogListPage>(`/api/admin/blog?page=${page}`);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function updateStatus(id: string, title: string, status: string) {
    const r = await sendAdmin(`/api/admin/blog/${id}`, "PATCH", { status });
    if (r.ok) {
      toast.success(`"${title}" ${status === "published" ? "yayınlandı" : "taslağa alındı"}.`);
      setMessage({ tone: "success", text: `"${title}" ${status === "published" ? "yayınlandı" : "taslağa alındı"}.` });
    } else {
      toast.error(r.error || "Güncelleme başarısız.");
      setMessage({ tone: "error", text: r.error || "Güncelleme başarısız." });
    }
    reload();
  }

  return (
    <>
      <PageHeader title="Blog" description="Mağazada yayınlanan rehber ve haber yazıları." actions={canWrite ? <Button asChild><Link href="/admin/blog/new"><Plus aria-hidden="true" />Yeni yazı</Link></Button> : null} />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <Panel bodyClassName="p-0">
        {loading && !data ? <p className="p-5 text-sm text-muted-foreground">Yükleniyor…</p> : data && !data.rows.length ? (
          <div className="p-4 sm:p-5"><EmptyState title="Henüz blog yazısı yok" action={canWrite ? <Button asChild variant="outline"><Link href="/admin/blog/new">İlk yazıyı ekle</Link></Button> : undefined} /></div>
        ) : (
          <>
            <div className="px-1 py-2 sm:px-2">
              <Table>
                <TableHeader><TableRow><TableHead>Başlık</TableHead><TableHead>Durum</TableHead><TableHead>Yayın tarihi</TableHead><TableHead>Son güncelleme</TableHead>{canWrite && <TableHead><span className="sr-only">İşlem</span></TableHead>}</TableRow></TableHeader>
                <TableBody>
                  {data?.rows.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="max-w-[22rem] whitespace-normal"><p className="font-medium">{p.title}</p><p className="text-xs text-muted-foreground">/{p.slug}</p></TableCell>
                      <TableCell className="min-w-[9rem]">
                        {canWrite ? (
                          <><label htmlFor={`b-status-${p.id}`} className="sr-only">{p.title} durumu</label>
                            <select id={`b-status-${p.id}`} className={selectClass} value={p.status} onChange={(e) => updateStatus(p.id, p.title, e.target.value)}><option value="draft">Taslak</option><option value="published">Yayında</option></select></>
                        ) : <StatusBadge tone={publishTone[p.status] ?? "neutral"}>{publishLabel[p.status] ?? p.status}</StatusBadge>}
                      </TableCell>
                      <TableCell>{trDate(p.publishedAt)}</TableCell>
                      <TableCell>{trDate(p.updatedAt)}</TableCell>
                      {canWrite && <TableCell className="text-right"><Button asChild variant="outline" size="sm"><Link href={`/admin/blog/${p.id}`} aria-label={`${p.title} yazısını düzenle`}>Düzenle</Link></Button></TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {data && data.pageCount > 1 && (
              <nav aria-label="Sayfalama" className="flex items-center justify-between gap-3 border-t p-4 sm:px-5">
                <Button type="button" variant="outline" className="min-h-11" disabled={data.page <= 1 || loading} onClick={() => setPage(data.page - 1)}>Önceki</Button>
                <span className="text-sm text-muted-foreground" aria-live="polite">Sayfa {data.page} / {data.pageCount}</span>
                <Button type="button" variant="outline" className="min-h-11" disabled={data.page >= data.pageCount || loading} onClick={() => setPage(data.page + 1)}>Sonraki</Button>
              </nav>
            )}
          </>
        )}
      </Panel>
    </>
  );
}
