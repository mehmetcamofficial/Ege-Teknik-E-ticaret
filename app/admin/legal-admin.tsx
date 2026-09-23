"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Status = "draft" | "scheduled" | "effective" | "superseded";
type VersionRow = { id: string; version: number; title: string; contentHash: string; effectiveAt: string | null; publishedAt: string | null; publishedBy: string | null; status: Status };
type VersionFull = VersionRow & { body: string };
const statusLabel: Record<Status, string> = { draft: "Taslak", scheduled: "Planlandı", effective: "Yürürlükte", superseded: "Yerini yenisi aldı" };
const slugLabel: Record<string, string> = { "distance-sales": "Mesafeli Satış Sözleşmesi", "pre-information": "Ön Bilgilendirme Formu", kvkk: "KVKK Aydınlatma Metni", privacy: "Gizlilik Politikası", cookies: "Çerez Politikası", "delivery-returns": "Teslimat / İade / İptal", terms: "Kullanım Koşulları" };
const fmt = (value: string | null) => (value ? new Date(value).toLocaleString("tr-TR") : "—");

/** Owner-only (legal:write). The server re-checks the permission on every call; hiding this section is a convenience, not the control. */
export default function LegalAdmin() {
  const [slugs, setSlugs] = useState<string[]>([]);
  const [slug, setSlug] = useState("");
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [selected, setSelected] = useState<VersionFull | null>(null);
  const [draft, setDraft] = useState({ title: "", body: "" });
  const [effectiveAt, setEffectiveAt] = useState("");
  const [note, setNote] = useState("");

  const loadVersions = useCallback(async (target: string) => {
    if (!target) return;
    const r = await fetch(`/api/admin/legal/documents/${target}/versions`);
    setVersions(r.ok ? ((await r.json()) as { versions: VersionRow[] }).versions : []);
  }, []);
  useEffect(() => {
    void (async () => {
      const r = await fetch("/api/admin/legal/documents");
      if (!r.ok) return setNote("Hukuki belgeler yüklenemedi.");
      const data = (await r.json()) as { documents: { slug: string }[]; startableSlugs: string[] };
      const all = [...new Set([...data.startableSlugs, ...data.documents.map((d) => d.slug)])];
      setSlugs(all);
      setSlug((current) => current || all[0] || "");
    })();
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadVersions(slug);
    setSelected(null);
  }, [slug, loadVersions]);

  async function open(id: string) {
    const r = await fetch(`/api/admin/legal/versions/${id}`);
    if (!r.ok) return setNote("Sürüm açılamadı.");
    const { version } = (await r.json()) as { version: VersionFull };
    setSelected(version);
    setDraft({ title: version.title, body: version.body });
    setNote("");
  }
  async function send(url: string, method: string, body?: object) {
    const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = (await r.json().catch(() => ({}))) as { error?: string; id?: string };
    if (!r.ok) setNote(json.error ?? "İşlem başarısız.");
    return r.ok ? json : null;
  }
  async function createDraft() {
    const title = `DRAFT — LEGAL REVIEW REQUIRED — ${slugLabel[slug] ?? slug}`;
    const created = await send(`/api/admin/legal/documents/${slug}/versions`, "POST", { title, body: "DRAFT — LEGAL REVIEW REQUIRED\n\nBu metin taslaktır; hukuki inceleme tamamlanmadan yayınlanmamalıdır." });
    if (created?.id) { await loadVersions(slug); await open(created.id); setNote("Yeni taslak oluşturuldu."); }
  }
  async function saveDraft() {
    if (!selected || !(await send(`/api/admin/legal/versions/${selected.id}`, "PATCH", draft))) return;
    setNote("Taslak kaydedildi."); await loadVersions(slug); await open(selected.id);
  }
  async function removeDraft() {
    if (!selected || !confirm("Bu taslak silinsin mi? (Yayınlanmış sürümler silinemez.)")) return;
    if (await send(`/api/admin/legal/versions/${selected.id}`, "DELETE")) { setSelected(null); setNote("Taslak silindi."); await loadVersions(slug); }
  }
  async function publish() {
    if (!selected || !effectiveAt) return setNote("Yürürlük tarihi seçin.");
    if (!confirm("Yayınlandıktan sonra bu sürüm değiştirilemez ve silinemez. Yayınlansın mı?")) return;
    if (await send(`/api/admin/legal/versions/${selected.id}/publish`, "POST", { effectiveAt: new Date(effectiveAt).toISOString() })) { setNote("Sürüm yayınlandı."); await loadVersions(slug); await open(selected.id); }
  }

  const isDraft = selected?.status === "draft";
  return <Card><CardHeader><CardTitle>Hukuki Belgeler</CardTitle><p className="mt-1 text-sm text-zinc-500">Yayınlanan sürümler değiştirilemez; metni değiştirmek için yeni sürüm oluşturun. Bu bölüm yalnızca yetkili sahip hesabı içindir.</p></CardHeader><CardContent className="grid gap-4">
    {note && <p className="rounded-lg bg-amber-100 px-4 py-3 text-sm">{note}</p>}
    <div className="flex flex-wrap items-end gap-3"><div><Label>Belge</Label><select className="h-9 rounded-md border bg-white px-3" value={slug} onChange={(e) => setSlug(e.target.value)}>{slugs.map((s) => <option key={s} value={s}>{slugLabel[s] ?? s}</option>)}</select></div><Button type="button" onClick={createDraft}>Yeni taslak sürüm</Button></div>
    <Table><TableHeader><TableRow><TableHead>Sürüm</TableHead><TableHead>Durum</TableHead><TableHead>Başlık</TableHead><TableHead>Yürürlük</TableHead><TableHead>Yayın</TableHead><TableHead>Yayınlayan</TableHead><TableHead>İçerik özeti (SHA-256)</TableHead><TableHead/></TableRow></TableHeader><TableBody>
      {versions.length ? versions.map((v) => <TableRow key={v.id}><TableCell>{v.version}</TableCell><TableCell>{statusLabel[v.status]}</TableCell><TableCell>{v.title}</TableCell><TableCell>{fmt(v.effectiveAt)}</TableCell><TableCell>{fmt(v.publishedAt)}</TableCell><TableCell>{v.publishedBy ?? "—"}</TableCell><TableCell className="max-w-40 truncate font-mono text-xs" title={v.contentHash}>{v.contentHash}</TableCell><TableCell><Button type="button" variant="outline" size="sm" onClick={() => void open(v.id)}>Aç</Button></TableCell></TableRow>) : <TableRow><TableCell colSpan={8} className="text-zinc-500">Bu belge için henüz sürüm yok.</TableCell></TableRow>}
    </TableBody></Table>
    {selected && <div className="grid gap-3 rounded-lg border p-4">
      <p className="text-sm font-semibold">Sürüm {selected.version} — {statusLabel[selected.status]}{!isDraft && " (salt okunur)"}</p>
      <div><Label>Başlık</Label><Input value={draft.title} readOnly={!isDraft} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></div>
      <div><Label>Metin (düz metin)</Label><Textarea rows={16} value={draft.body} readOnly={!isDraft} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></div>
      <div className="flex flex-wrap items-end gap-3">
        <a className="text-sm underline" href={`/api/admin/legal/versions/${selected.id}/preview`} target="_blank" rel="noopener">Önizle</a>
        {isDraft && <><Button type="button" onClick={saveDraft}>Taslağı kaydet</Button><Button type="button" variant="outline" onClick={removeDraft}>Taslağı sil</Button>
          <div><Label>Yürürlük tarihi (zorunlu)</Label><Input type="datetime-local" value={effectiveAt} onChange={(e) => setEffectiveAt(e.target.value)} /></div><Button type="button" onClick={publish}>Yayınla</Button></>}
      </div>
    </div>}
  </CardContent></Card>;
}
