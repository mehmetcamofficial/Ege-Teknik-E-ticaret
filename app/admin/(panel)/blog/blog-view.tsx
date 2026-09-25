"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, Notice, PageHeader, Panel, StatusBadge, selectClass } from "@/components/admin/ui";
import { sendAdmin, useAdminJson, type Overview } from "@/components/admin/use-admin-data";
import { publishLabel, publishTone, trDate } from "@/lib/admin-ui";

export default function BlogView({ canWrite }: { canWrite: boolean }) {
  const { data, error, loading, reload } = useAdminJson<Overview>("/api/admin/overview");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function updateStatus(id: string, title: string, status: string) {
    const r = await sendAdmin(`/api/admin/blog/${id}`, "PATCH", { status });
    setMessage(r.ok ? { tone: "success", text: `"${title}" ${status === "published" ? "yayınlandı" : "taslağa alındı"}.` } : { tone: "error", text: r.error || "Güncelleme başarısız." });
    reload();
  }

  return (
    <>
      <PageHeader title="Blog" description="Mağazada yayınlanan rehber ve haber yazıları." actions={canWrite ? <Button asChild><Link href="/admin/blog/new"><Plus aria-hidden="true" />Yeni yazı</Link></Button> : null} />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <Panel bodyClassName="p-0">
        {loading && !data ? <p className="p-5 text-sm text-muted-foreground">Yükleniyor…</p> : data && !data.posts.length ? (
          <div className="p-4 sm:p-5"><EmptyState title="Henüz blog yazısı yok" action={canWrite ? <Button asChild variant="outline"><Link href="/admin/blog/new">İlk yazıyı ekle</Link></Button> : undefined} /></div>
        ) : (
          <div className="px-1 py-2 sm:px-2">
            <Table>
              <TableHeader><TableRow><TableHead>Başlık</TableHead><TableHead>Durum</TableHead><TableHead>Yayın tarihi</TableHead><TableHead>Son güncelleme</TableHead>{canWrite && <TableHead><span className="sr-only">İşlem</span></TableHead>}</TableRow></TableHeader>
              <TableBody>
                {data?.posts.map((p) => (
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
        )}
      </Panel>
    </>
  );
}
