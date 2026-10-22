"use client";

import { useEffect, useState } from "react";
import { calculateProfit } from "@/lib/profitability";

const initial = {
  saleGrossKurus: 3_000_000,
  saleVatBps: 2000,
  purchaseNetKurus: 2_000_000,
  shippingNetKurus: 50_000,
  installationNetKurus: 150_000,
  otherNetKurus: 10_000,
  posFeeBps: 300,
  posFixedKurus: 0,
};
const labels: Record<keyof typeof initial, string> = {
  saleGrossKurus: "Satış fiyatı (KDV dahil TL)",
  saleVatBps: "KDV (%)",
  purchaseNetKurus: "Alış fiyatı (KDV hariç TL)",
  shippingNetKurus: "Kargo (KDV hariç TL)",
  installationNetKurus: "Montaj (KDV hariç TL)",
  otherNetKurus: "Diğer maliyetler (KDV hariç TL)",
  posFeeBps: "POS komisyonu (%)",
  posFixedKurus: "Sabit POS ücreti (TL)",
};
const money = (kurus: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(kurus / 100);
export default function ProfitabilityCalculator() {
  const [values, setValues] = useState(initial);
  const [question, setQuestion] = useState("Teklif hazırlarken kârlılığı nasıl kontrol etmeliyim?");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const outcome = (() => { try { return calculateProfit(values); } catch { return null; } })();
  useEffect(() => {
    fetch("/api/admin/finance/profitability/ai", { cache: "no-store" })
      .then(r => r.ok ? r.json() : { enabled: false })
      .then(d => setEnabled(d.enabled === true))
      .catch(() => setEnabled(false));
  }, []);
  async function ask() {
    if (!enabled || busy) return;
    setBusy(true); setError(""); setAnswer("");
    try {
      // Costs and product identities are intentionally NOT transmitted.
      const r = await fetch("/api/admin/finance/profitability/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
        signal: AbortSignal.timeout(15000),
      });
      const payload: { answer?: string; error?: string } = await r.json();
      if (!r.ok) throw new Error(payload.error ?? "Yanıt alınamadı.");
      setAnswer(payload.answer ?? "");
    } catch (e) { setError(e instanceof DOMException && e.name === "TimeoutError" ? "Danışman zaman aşımına uğradı. Mevcut hesaplayıcıyı kullanabilirsiniz." : e instanceof Error ? e.message : "İşlem başarısız."); }
    finally { setBusy(false); }
  }
  return <div className="grid gap-6">
    <section className="rounded-xl border bg-card p-5 space-y-4">
      <div><h2 className="text-lg font-semibold">Kârlılık Senaryosu</h2>
      <p className="text-sm text-muted-foreground">Kaydetmez; ürün, fiyat ve stok değişikliği yapmaz. Maliyetleri KDV hariç girin.</p></div>
      <div className="grid gap-3 sm:grid-cols-2">
        {(Object.keys(initial) as (keyof typeof initial)[]).map(key => {
          const isRate = key.endsWith("Bps");
          return <label key={key} className="grid gap-1 text-sm">{labels[key]}
            <input type="number" min={0} max={isRate ? 100 : undefined} step="0.01"
              className="rounded-md border bg-background p-2"
              value={isRate ? values[key] / 100 : values[key] / 100}
              onChange={e => {
                const x = Number(e.target.value);
                if (!Number.isFinite(x) || x < 0 || (isRate && x > 100) || (!isRate && x > 1_000_000_000)) return;
                const n = Math.round(x * 100);
                setValues(old => ({ ...old, [key]: n }));
              }} />
          </label>;
        })}
      </div>
      {!outcome && <p role="alert" className="text-red-600">Tutarlar hesaplama sınırını aşıyor. Değerleri azaltın.</p>}
      {outcome && <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-muted p-4"><div className="text-xs text-muted-foreground">Net satış geliri</div><strong>{money(outcome.revenueNetKurus)}</strong></div>
        <div className="rounded-lg bg-muted p-4"><div className="text-xs text-muted-foreground">Değişken maliyetler</div><strong>{money(outcome.variableCostKurus)}</strong></div>
        <div className="rounded-lg bg-muted p-4"><div className="text-xs text-muted-foreground">Katkı tutarı</div><strong className={outcome.lossWarning ? "text-red-600" : ""}>{money(outcome.contributionKurus)}</strong></div>
      </div>}
      {outcome && <p className="text-sm">Katkı marjı: <strong>{outcome.contributionMarginBps === null ? "Hesaplanamaz" : (outcome.contributionMarginBps / 100).toFixed(2) + "%"}</strong>
      {outcome.lossWarning && <span className="ml-2 text-red-600">Zarar riski!</span>}</p>}
      <p className="text-xs text-muted-foreground">Bu hesap muhasebesel net kâr değildir; sabit giderler, iadeler ve vergi yükümlülükleri hariçtir.</p>
    </section>
    <section className="rounded-xl border bg-card p-5 space-y-3">
      <h2 className="text-lg font-semibold">AI Kârlılık Danışmanı</h2>
      <p className="text-sm text-muted-foreground">{enabled ? "Aktif — sağlayıcıya yalnız konu kategorisi gönderilir; finans kayıtları gönderilmez." : "Pasif — AI Gateway henüz etkinleştirilmedi."}</p>
      <p className="text-sm text-muted-foreground">Kişisel bilgi yazmayın. Öneriler kayıt değiştirmez ve eksik maliyetlerle net kâr hesaplamaz.</p>
      <label className="grid gap-1 text-sm">Soru
        <textarea className="rounded-md border bg-background p-2 min-h-24" value={question}
          maxLength={1000} disabled={!enabled || busy} onChange={e => setQuestion(e.target.value)} />
      </label>
      <button type="button" disabled={!enabled || !question.trim()} aria-disabled={busy || undefined}
        className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
        onClick={() => void ask()}>{busy ? "Analiz ediliyor..." : "AI'ya sor"}</button>
      {error && <p role="alert" className="text-red-600">{error}</p>}
      {answer && <p aria-live="polite" className="whitespace-pre-wrap rounded-md bg-muted p-4 text-sm">{answer}</p>}
    </section>
  </div>;
}
