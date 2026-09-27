"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, FormField, Notice, Panel, StatusBadge, selectClass } from "@/components/admin/ui";
import { useAdminJson } from "@/components/admin/use-admin-data";
import { paymentStatusLabel, paymentStatusTone, trDate, tryCurrency } from "@/lib/admin-ui";
import { manualPaymentMethods, paymentMethodLabel, type OrderPaymentStatus } from "@/lib/finance";

type Ledger = {
  total: number; orderStatus: string; paymentStatus: OrderPaymentStatus; storedPaymentStatus: string; unbackedPaid: boolean;
  collected: number; refunded: number; netCollected: number; outstanding: number;
  payments: { id: string; provider: string; method: string | null; amount: number; status: string; reference: string; note: string; paidAt: string | null; refundedAmount: number }[];
  refunds: { id: string; paymentId: string | null; amount: number; status: string; reason: string; refundedAt: string | null }[];
};
const methodName = (m: string | null) => (m ? paymentMethodLabel[m as keyof typeof paymentMethodLabel] ?? m : "Belirtilmemiş");

/**
 * POST with an Idempotency-Key. The key is created once per intended action and kept until the server answers
 * definitively, so a double click or a retry after a network error records the payment/refund exactly once.
 */
async function postIdempotent(url: string, key: string, body: unknown): Promise<{ ok: boolean; error?: string; definitive: boolean }> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body) });
    const json = (await r.json().catch(() => ({}))) as { error?: string };
    return r.ok ? { ok: true, definitive: true } : { ok: false, error: json.error || "İşlem tamamlanamadı.", definitive: r.status < 500 };
  } catch {
    return { ok: false, error: "Sunucuya ulaşılamadı. Tekrar denediğinizde aynı işlem tek kez kaydedilir.", definitive: false };
  }
}

export default function OrderPaymentsPanel({ orderId, canWrite, onChanged }: { orderId: string; canWrite: boolean; onChanged: () => void }) {
  const { data, error, reload } = useAdminJson<Ledger>(`/api/admin/orders/${orderId}/payments`);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<string>("bank_transfer");
  const [payReference, setPayReference] = useState("");
  const [payKey, setPayKey] = useState(() => crypto.randomUUID());
  const [refundPayment, setRefundPayment] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundKey, setRefundKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);

  if (error) return <Panel title="Ödemeler"><Notice tone="error">{error}</Notice></Panel>;
  if (!data) return <Panel title="Ödemeler"><p className="text-sm text-muted-foreground">Yükleniyor…</p></Panel>;

  const refundable = data.payments.filter((p) => p.status === "paid" && p.method !== "online" && p.amount - p.refundedAmount > 0);
  const closed = data.orderStatus === "cancelled" || data.orderStatus === "returned";
  const done = () => { reload(); onChanged(); };

  async function savePayment() {
    const amount = Number(payAmount);
    if (!Number.isInteger(amount) || amount <= 0) return toast.error("Tutarı tam TL olarak girin.");
    setBusy(true);
    const r = await postIdempotent(`/api/admin/orders/${orderId}/payments`, payKey, { amount, method: payMethod, reference: payReference.trim() });
    setBusy(false);
    if (r.definitive) setPayKey(crypto.randomUUID());
    if (!r.ok) return toast.error(r.error);
    toast.success("Ödeme kaydedildi.");
    setPayAmount(""); setPayReference(""); done();
  }

  async function saveRefund() {
    const amount = Number(refundAmount);
    if (!refundPayment) return toast.error("İade edilecek ödemeyi seçin.");
    if (!Number.isInteger(amount) || amount <= 0) return toast.error("Tutarı tam TL olarak girin.");
    setBusy(true);
    const r = await postIdempotent(`/api/admin/orders/${orderId}/refunds`, refundKey, { paymentId: refundPayment, amount, reason: refundReason.trim() });
    setBusy(false);
    if (r.definitive) setRefundKey(crypto.randomUUID());
    if (!r.ok) return toast.error(r.error);
    toast.success("İade kaydedildi.");
    setRefundAmount(""); setRefundReason(""); setRefundPayment(""); done();
  }

  return (
    <Panel title="Ödemeler" actions={<StatusBadge tone={paymentStatusTone[data.paymentStatus] ?? "neutral"}>{paymentStatusLabel[data.paymentStatus] ?? data.paymentStatus}</StatusBadge>}>
      <div className="grid gap-4">
        {data.unbackedPaid && <Notice tone="error">Bu sipariş eski yöntemle &quot;Ödendi&quot; işaretlenmiş ancak ödeme kaydı yok. Tahsilat alındıysa aşağıdan kaydedin.</Notice>}
        <dl className="grid gap-2 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Tahsil edilen</dt><dd className="tabular-nums">{tryCurrency(data.collected)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">İade edilen</dt><dd className="tabular-nums">{tryCurrency(data.refunded)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Net tahsilat</dt><dd className="tabular-nums">{tryCurrency(data.netCollected)}</dd></div>
          <div className="flex justify-between gap-3 border-t pt-2 font-semibold"><dt>Kalan bakiye</dt><dd className="tabular-nums">{closed ? "—" : tryCurrency(data.outstanding)}</dd></div>
        </dl>

        {data.payments.length ? (
          <ul className="grid gap-2 text-sm">
            {data.payments.map((p) => (
              <li key={p.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{methodName(p.method)}</span><span className="tabular-nums">{tryCurrency(p.amount)}</span></div>
                <p className="text-xs text-muted-foreground">{trDate(p.paidAt, true)}{p.reference ? ` · ${p.reference}` : ""}{p.refundedAmount > 0 ? ` · iade ${tryCurrency(p.refundedAmount)}` : ""}</p>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="Ödeme kaydı yok" description="Ödeme sağlayıcısı aktif değil; alınan nakit, EFT veya POS tahsilatı elle kaydedilir." />}

        {data.refunds.length > 0 && (
          <div className="grid gap-1 text-sm">
            <p className="font-medium">İadeler</p>
            {data.refunds.map((r) => <p key={r.id} className="text-muted-foreground">{trDate(r.refundedAt, true)} · {tryCurrency(r.amount)} · {r.reason}</p>)}
          </div>
        )}

        {canWrite && !closed && data.outstanding > 0 && (
          <fieldset className="grid gap-3 border-t pt-4" disabled={busy}>
            <legend className="text-sm font-semibold">Tahsilat kaydet</legend>
            <FormField label="Tutar (TL)" htmlFor="pay-amount" hint={`Kalan bakiye: ${tryCurrency(data.outstanding)}`}>
              <Input id="pay-amount" inputMode="numeric" value={payAmount} onChange={(e) => setPayAmount(e.target.value.replace(/\D/g, ""))} placeholder={String(data.outstanding)} />
            </FormField>
            <FormField label="Yöntem" htmlFor="pay-method">
              <select id="pay-method" className={selectClass} value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>{manualPaymentMethods.map((m) => <option key={m} value={m}>{paymentMethodLabel[m]}</option>)}</select>
            </FormField>
            <FormField label="Referans (dekont / slip no)" htmlFor="pay-reference">
              <Input id="pay-reference" maxLength={100} value={payReference} onChange={(e) => setPayReference(e.target.value)} />
            </FormField>
            <Button type="button" onClick={() => void savePayment()}>Ödemeyi kaydet</Button>
          </fieldset>
        )}

        {canWrite && refundable.length > 0 && (
          <fieldset className="grid gap-3 border-t pt-4" disabled={busy}>
            <legend className="text-sm font-semibold">İade kaydet</legend>
            <p className="text-xs text-muted-foreground">Müşteriye geri ödenmiş parayı kaydeder; ödeme sağlayıcısında işlem yapmaz ve stok değiştirmez.</p>
            <FormField label="Ödeme" htmlFor="refund-payment">
              <select id="refund-payment" className={selectClass} value={refundPayment} onChange={(e) => setRefundPayment(e.target.value)}>
                <option value="">Seçin</option>
                {refundable.map((p) => <option key={p.id} value={p.id}>{methodName(p.method)} · iade edilebilir {tryCurrency(p.amount - p.refundedAmount)}</option>)}
              </select>
            </FormField>
            <FormField label="Tutar (TL)" htmlFor="refund-amount">
              <Input id="refund-amount" inputMode="numeric" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value.replace(/\D/g, ""))} />
            </FormField>
            <FormField label="Gerekçe" htmlFor="refund-reason">
              <Input id="refund-reason" maxLength={500} value={refundReason} onChange={(e) => setRefundReason(e.target.value)} />
            </FormField>
            <Button type="button" variant="outline" onClick={() => void saveRefund()}>İadeyi kaydet</Button>
          </fieldset>
        )}
      </div>
    </Panel>
  );
}
