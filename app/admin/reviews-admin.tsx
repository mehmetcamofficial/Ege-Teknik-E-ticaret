"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Status = "pending" | "approved" | "rejected";
type HistoryEntry = { action: string; actorEmail: string; payload: { from?: string; to?: string; note?: string | null }; createdAt: string };
type AdminReview = { id: string; productId: string; productName: string; rating: number; displayName: string; body: string; status: Status; verifiedPurchase: boolean; createdAt: string; moderatedAt: string | null; moderationNote: string | null; orderNumber: string | null; history: HistoryEntry[] };
const statusLabel: Record<Status, string> = { pending: "İncelemede", approved: "Yayında", rejected: "Reddedildi" };
const fmt = (value: string | null) => (value ? new Date(value).toLocaleString("tr-TR") : "—");
/** Mirrors lib/reviews canTransitionReview; the server re-validates every decision. */
const actionsFor: Record<Status, { to: "approved" | "rejected"; label: string }[]> = {
  pending: [{ to: "approved", label: "Onayla" }, { to: "rejected", label: "Reddet" }],
  approved: [{ to: "rejected", label: "Yayından kaldır (reddet)" }],
  rejected: [{ to: "approved", label: "Kararı geri al (onayla)" }],
};

async function fetchReviews(target: Status): Promise<AdminReview[] | null> {
  const r = await fetch(`/api/admin/reviews?status=${target}`);
  return r.ok ? ((await r.json()) as { reviews: AdminReview[] }).reviews : null;
}

/** content:write only. Moderation changes status and note; review content can never be edited here or in the database. */
export default function ReviewsAdmin() {
  const [status, setStatus] = useState<Status>("pending");
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("Yükleniyor…");

  const apply = useCallback((result: AdminReview[] | null) => {
    if (!result) { setReviews([]); setMessage("Yorumlar yüklenemedi."); return; }
    setReviews(result); setMessage(result.length ? "" : "Bu durumda yorum yok.");
  }, []);
  useEffect(() => {
    let cancelled = false; // a slower response for an old filter must not overwrite the current one
    void (async () => { const result = await fetchReviews(status); if (!cancelled) apply(result); })();
    return () => { cancelled = true; };
  }, [status, apply]);

  async function decide(review: AdminReview, to: "approved" | "rejected") {
    const note = (notes[review.id] ?? "").trim();
    const r = await fetch(`/api/admin/reviews/${encodeURIComponent(review.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(note ? { status: to, note } : { status: to }) });
    const data = (await r.json().catch(() => ({}))) as { error?: string };
    if (r.ok) {
      toast.success(`Yorum ${to === "approved" ? "onaylandı" : "reddedildi"}.`);
      setMessage(`Yorum ${to === "approved" ? "onaylandı" : "reddedildi"}.`);
    } else {
      toast.error(data.error || "İşlem tamamlanamadı.");
      setMessage(data.error || "İşlem tamamlanamadı.");
    }
    apply(await fetchReviews(status));
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Yorum durumu">
          {(Object.keys(statusLabel) as Status[]).map((s) => <Button key={s} type="button" variant={s === status ? "default" : "outline"} aria-pressed={s === status} onClick={() => setStatus(s)}>{statusLabel[s]}</Button>)}
        </div>
        {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
        <ul className="space-y-4">
          {reviews.map((review) => (
            <li key={review.id} className="rounded-lg border p-4 space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <a className="font-semibold underline" href={`/product.html?id=${encodeURIComponent(review.productId)}`} target="_blank" rel="noreferrer">{review.productName}</a>
                <span className="text-sm">{fmt(review.createdAt)}</span>
              </div>
              <p className="text-sm"><b>{review.rating}/5</b> <span aria-hidden="true">{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</span> · {review.displayName} · {statusLabel[review.status]} · {review.verifiedPurchase ? `Doğrulanmış satın alma${review.orderNumber ? ` (${review.orderNumber})` : ""}` : "Doğrulanmamış"}</p>
              <p className="whitespace-pre-line break-words text-sm">{review.body}</p>
              {review.moderationNote && <p className="text-sm text-muted-foreground">Not: {review.moderationNote}</p>}
              {review.history.length > 0 && (
                <details className="text-sm"><summary>Moderasyon geçmişi ({review.history.length})</summary>
                  <ol className="mt-2 list-decimal pl-5">{review.history.map((h, i) => <li key={i}>{fmt(h.createdAt)} · {h.actorEmail} · {statusLabel[(h.payload.from as Status)] ?? h.payload.from} → {statusLabel[(h.payload.to as Status)] ?? h.payload.to}{h.payload.note ? ` · ${h.payload.note}` : ""}</li>)}</ol>
                </details>
              )}
              <div className="grid gap-2">
                <Label htmlFor={`note-${review.id}`}>Moderasyon notu (isteğe bağlı, yalnızca yönetim görür)</Label>
                <Textarea id={`note-${review.id}`} maxLength={500} value={notes[review.id] ?? ""} onChange={(e) => setNotes({ ...notes, [review.id]: e.target.value })} />
                <div className="flex flex-wrap gap-2">{actionsFor[review.status].map((a) => <Button key={a.to} type="button" variant={a.to === "rejected" ? "destructive" : "default"} onClick={() => void decide(review, a.to)}>{a.label}</Button>)}</div>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
