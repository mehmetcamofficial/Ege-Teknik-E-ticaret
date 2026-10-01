"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { RecordActions, type RecordAction } from "@/components/admin/record-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { recordActionLabel, recordActionUnavailableReason } from "@/lib/admin-ui";

type Status = "draft" | "scheduled" | "effective" | "superseded";
type VersionRow = { id: string; version: number; title: string; contentHash: string; effectiveAt: string | null; publishedAt: string | null; publishedBy: string | null; status: Status };
type VersionFull = VersionRow & { body: string };
const statusLabel: Record<Status, string> = { draft: "Taslak", scheduled: "Planlandı", effective: "Yürürlükte", superseded: "Yerini yenisi aldı" };
const slugLabel: Record<string, string> = { "distance-sales": "Mesafeli Satış Sözleşmesi", "pre-information": "Ön Bilgilendirme Formu", kvkk: "KVKK Aydınlatma Metni", privacy: "Gizlilik Politikası", cookies: "Çerez Politikası", "delivery-returns": "Teslimat / İade / İptal", terms: "Kullanım Koşulları" };
const fmt = (value: string | null) => (value ? new Date(value).toLocaleString("tr-TR") : "—");

/** Always the same four buttons in the same order; only a draft's are operable. */
const ALL_ACTIONS = ["view", "edit", "publish", "delete"] as const satisfies readonly (keyof typeof recordActionLabel)[];
type LegalActionKey = (typeof ALL_ACTIONS)[number];


/** Owner-only (legal:write). The server re-checks the permission on every call; hiding this section is a convenience, not the control. */
export default function LegalAdmin() {
  const [slugs, setSlugs] = useState<string[]>([]);
  const [slug, setSlug] = useState("");
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [selected, setSelected] = useState<VersionFull | null>(null);
  const [draft, setDraft] = useState({ title: "", body: "" });
  const [effectiveAt, setEffectiveAt] = useState("");
  const [note, setNote] = useState("");
  // Default = hidden. Toggling is how an authorized admin inspects the immutable legacy fixtures.
  const [showLegacy, setShowLegacy] = useState(false);
  const [hiddenLegacyCount, setHiddenLegacyCount] = useState(0);
  const [legacyHidingActive, setLegacyHidingActive] = useState(false);

  // Record-specific confirmation targets. A row-level action and the editor's own buttons open the
  // SAME dialog, so the confirmation always names the version it will act on.
  const [deleteTarget, setDeleteTarget] = useState<VersionRow | null>(null);
  const [publishTarget, setPublishTarget] = useState<VersionRow | null>(null);
  const [busy, setBusy] = useState(false);

  const loadVersions = useCallback(async (target: string, includeLegacy = false) => {
    if (!target) return;
    const r = await fetch(`/api/admin/legal/documents/${target}/versions${includeLegacy ? "?legacy=1" : ""}`);
    if (!r.ok) return setVersions([]);
    const data = (await r.json()) as { versions: VersionRow[]; hiddenLegacyCount?: number; legacyHidingActive?: boolean };
    setVersions(data.versions);
    setHiddenLegacyCount(data.hiddenLegacyCount ?? 0);
    setLegacyHidingActive(data.legacyHidingActive ?? false);
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
    void loadVersions(slug, showLegacy);
    setSelected(null);
  }, [slug, showLegacy, loadVersions]);

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
    if (created?.id) { await loadVersions(slug, showLegacy); await open(created.id); setNote("Yeni taslak oluşturuldu."); }
  }
  async function saveDraft() {
    if (!selected) return;
    const saved = await send(`/api/admin/legal/versions/${selected.id}`, "PATCH", draft);
    // On failure `send` has already surfaced the error and the editor keeps the operator's text: nothing below runs.
    if (!saved) return;
    await loadVersions(slug, showLegacy);
    setSelected(null); // collapse back to the list, where the saved row is now visible with its actions
    setNote("");
    toast.success("Taslak başarıyla kaydedildi.");
  }
  async function confirmRemoveDraft() {
    if (!deleteTarget) return;
    setBusy(true);
    const res = await send(`/api/admin/legal/versions/${deleteTarget.id}`, "DELETE");
    setBusy(false);
    setDeleteTarget(null);
    if (res) {
      toast.success(`"${deleteTarget.title}" taslağı silindi.`);
      setNote("");
      // Stay on the same document (the operator keeps their context); drop the editor if it was open.
      if (selected?.id === deleteTarget.id) setSelected(null);
      await loadVersions(slug, showLegacy);
    }
  }
  async function confirmPublish() {
    if (!publishTarget) return;
    if (!effectiveAt) {
      toast.error("Yürürlük tarihi seçin.");
      setNote("Yayınlamak için yürürlük tarihi seçin.");
      return;
    }
    setBusy(true);
    const res = await send(`/api/admin/legal/versions/${publishTarget.id}/publish`, "POST", { effectiveAt: new Date(effectiveAt).toISOString() });
    setBusy(false);
    setPublishTarget(null);
    if (res) {
      toast.success(`"${publishTarget.title}" yayınlandı.`);
      setNote("");
      await loadVersions(slug, showLegacy);
      if (selected?.id === publishTarget.id) await open(publishTarget.id);
    }
  }

  /**
   * The action set for one version. A published version is immutable in the DATABASE, not just in this
   * form, so its edit/publish/delete buttons stay visible but disabled with the reason - the operator
   * learns the rule instead of wondering where the actions went.
   */
  function actionsFor(v: VersionRow): RecordAction[] {
    const draftVersion = v.status === "draft";
    const locked = recordActionUnavailableReason.legalPublishedImmutable;
    const byKey: Record<LegalActionKey, RecordAction> = {
      view: { key: "view", onClick: () => void open(v.id) },
      edit: draftVersion ? { key: "edit", onClick: () => void open(v.id) } : { key: "edit", unavailableReason: locked },
      publish: draftVersion ? { key: "publish", onClick: () => setPublishTarget(v) } : { key: "publish", unavailableReason: locked },
      delete: draftVersion ? { key: "delete", onClick: () => setDeleteTarget(v) } : { key: "delete", unavailableReason: locked },
    };
    return ALL_ACTIONS.map((key) => byKey[key]);
  }

  const isDraft = selected?.status === "draft";
  return <Card><CardContent className="grid gap-4">
    {note && <p className="rounded-lg bg-amber-100 px-4 py-3 text-sm">{note}</p>}
    <div className="flex flex-wrap items-end gap-3"><div><Label htmlFor="legal-document">Belge</Label><select id="legal-document" className="h-9 rounded-md border bg-white px-3" value={slug} onChange={(e) => setSlug(e.target.value)}>{slugs.map((s) => <option key={s} value={s}>{slugLabel[s] ?? s}</option>)}</select></div><Button type="button" onClick={createDraft}>Yeni taslak sürüm</Button>
      {legacyHidingActive && (
        <Button type="button" variant="outline" aria-pressed={showLegacy} onClick={() => setShowLegacy((v) => !v)}>
          {showLegacy ? "Eski/Test kayıtlarını gizle" : "Eski/Test kayıtlarını göster"}
          {hiddenLegacyCount > 0 ? ` (${hiddenLegacyCount})` : ""}
        </Button>
      )}
      {legacyHidingActive && hiddenLegacyCount > 0 && !showLegacy && (
        <p className="w-full text-xs text-muted-foreground">
          {hiddenLegacyCount} eski test kaydı gizleniyor. Bu kayıtlar yayınlandıkları için veritabanında değiştirilemez; geçmişe erişmek için yukarıdaki düğmeyi kullanın.
        </p>
      )}</div>
    <Table><TableHeader><TableRow><TableHead>Sürüm</TableHead><TableHead>Durum</TableHead><TableHead>Başlık</TableHead><TableHead>Yürürlük</TableHead><TableHead>Yayın</TableHead><TableHead>Yayınlayan</TableHead><TableHead>İçerik özeti (SHA-256)</TableHead><TableHead className="text-left">İşlemler</TableHead></TableRow></TableHeader><TableBody>
      {versions.length ? versions.map((v) => <TableRow key={v.id}><TableCell>{v.version}</TableCell><TableCell>{statusLabel[v.status]}</TableCell><TableCell>{v.title}</TableCell><TableCell>{fmt(v.effectiveAt)}</TableCell><TableCell>{fmt(v.publishedAt)}</TableCell><TableCell>{v.publishedBy ?? "—"}</TableCell><TableCell className="max-w-40 truncate font-mono text-xs" title={v.contentHash}>{v.contentHash}</TableCell><TableCell><RecordActions actions={actionsFor(v)} label={`${slugLabel[slug] ?? slug} sürüm ${v.version} işlemleri`} /></TableCell></TableRow>) : <TableRow><TableCell colSpan={8} className="text-zinc-500">Bu belge için henüz sürüm yok.</TableCell></TableRow>}
    </TableBody></Table>
    {selected && <div className="grid gap-3 rounded-lg border p-4">
      <p className="text-sm font-semibold">Sürüm {selected.version} — {statusLabel[selected.status]}{!isDraft && " (salt okunur)"}</p>
      <div><Label>Başlık</Label><Input value={draft.title} readOnly={!isDraft} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></div>
      <div><Label>Metin (düz metin)</Label><Textarea rows={16} value={draft.body} readOnly={!isDraft} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></div>
      <div className="flex flex-wrap items-end gap-3">
        <a className="text-sm underline" href={`/api/admin/legal/versions/${selected.id}/preview`} target="_blank" rel="noopener">Önizle</a>
        {isDraft && <><Button type="button" onClick={saveDraft}>Taslağı kaydet</Button>
          <div><Label>Yürürlük tarihi (zorunlu)</Label><Input type="datetime-local" value={effectiveAt} onChange={(e) => setEffectiveAt(e.target.value)} /></div><Button type="button" onClick={() => setPublishTarget(selected)}>Yayınla</Button></>}
      </div>
    </div>}

    <ConfirmDialog
      open={Boolean(deleteTarget)}
      onOpenChange={(open) => !open && setDeleteTarget(null)}
      title="Taslak Sürüm Silme Onayı"
      description={deleteTarget ? <span><strong>{deleteTarget.title}</strong> (sürüm {deleteTarget.version}) taslağını silmek istediğinizden emin misiniz? Bu işlem geri alınamaz; yayınlanmış sürümler ise veritabanında değiştirilemez biçimde korunur.</span> : null}
      confirmLabel="Evet, Sil"
      cancelLabel="Vazgeç"
      variant="destructive"
      loading={busy}
      onConfirm={confirmRemoveDraft}
    />

    <ConfirmDialog
      open={Boolean(publishTarget)}
      onOpenChange={(open) => !open && setPublishTarget(null)}
      title="Yasal Belge Sürümünü Yayınlama Onayı"
      description={publishTarget ? <span><strong>{publishTarget.title}</strong> (sürüm {publishTarget.version}) yayınlanacak. Yayınlandıktan sonra içeriği ve SHA-256 özeti kilitlenir; değiştirilemez veya silinemez. Yayınlamak istediğinizden emin misiniz?</span> : null}
      confirmLabel="Evet, Yayınla"
      cancelLabel="Vazgeç"
      loading={busy}
      onConfirm={confirmPublish}
    />
  </CardContent></Card>;
}
