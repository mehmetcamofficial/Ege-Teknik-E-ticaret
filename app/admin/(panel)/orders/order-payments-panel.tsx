"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, FormField, Notice, Panel, StatusBadge, selectClass } from "@/components/admin/ui";
import { useAdminJson } from "@/components/admin/use-admin-data";
import { paymentStatusLabel, paymentStatusTone, trDate, tryCurrency, type Tone } from "@/lib/admin-ui";
import { manualPaymentMethods, paymentMethodLabel, type OrderPaymentStatus } from "@/lib/finance";

export type Ledger = {
  total: number; orderStatus: string; paymentStatus: OrderPaymentStatus; storedPaymentStatus: string; unbackedPaid: boolean;
  collected: number; refunded: number; netCollected: number; outstanding: number;
  payments: { id: string; provider: string; method: string | null; amount: number; status: string; reference: string; note: string; paidAt: string | null; createdAt: string; refundedAmount: number }[];
  refunds: { id: string; paymentId: string | null; amount: number; status: string; reason: string; refundedAt: string | null }[];
};
const methodName = (m: string | null) => (m ? paymentMethodLabel[m as keyof typeof paymentMethodLabel] ?? m : "Belirtilmemiş");
/** Online attempts that are not (yet) paid are listed for traceability but never shown as collected money. */
const attemptLabel: Record<string, string> = { pending: "bekliyor", failed: "başarısız", cancelled: "yenilendi" };
const attemptTone: Record<string, Tone> = { pending: "warning", failed: "danger", cancelled: "neutral" };
const isClosed = (l: Ledger) => l.orderStatus === "cancelled" || l.orderStatus === "returned";

/** One ledger read per order detail screen; every payment card renders from it. */
export function useOrderLedger(orderId: string) {
  return useAdminJson<Ledger>(`/api/admin/orders/${orderId}/payments`);
}

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

type LedgerState = { data: Ledger | null; error: string | null };
const loadingOrError = (s: LedgerState) => (s.error ? <Notice tone="error">{s.error}</Notice> : <p className="text-sm text-muted-foreground">Yükleniyor…</p>);

/** Derived payment status and the four ledger amounts. */
export function PaymentSummaryPanel({ ledger, className }: { ledger: LedgerState; className?: string }) {
  const l = ledger.data;
  return (
    <Panel title="Ödeme özeti" className={className} actions={l && <StatusBadge tone={paymentStatusTone[l.paymentStatus] ?? "neutral"}>{paymentStatusLabel[l.paymentStatus] ?? l.paymentStatus}</StatusBadge>}>
      {!l ? loadingOrError(ledger) : (
        <div className="grid gap-3">
          {l.unbackedPaid && <Notice tone="error">Bu sipariş eski yöntemle &quot;Ödendi&quot; işaretlenmiş ancak ödeme kaydı yok. Tahsilat alındıysa aşağıdan kaydedin.</Notice>}
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Tahsil edilen</dt><dd className="tabular-nums">{tryCurrency(l.collected)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">İade edilen</dt><dd className="tabular-nums">{tryCurrency(l.refunded)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Net tahsilat</dt><dd className="tabular-nums">{tryCurrency(l.netCollected)}</dd></div>
            <div className="flex justify-between gap-3 border-t pt-2 font-semibold"><dt>Kalan bakiye</dt><dd className="tabular-nums">{isClosed(l) ? "—" : tryCurrency(l.outstanding)}</dd></div>
          </dl>
        </div>
      )}
    </Panel>
  );
}

/** Every recorded payment and refund, newest last, as recorded in the ledger. */
export function PaymentHistoryPanel({ ledger }: { ledger: LedgerState }) {
  const l = ledger.data;
  const rows = l ? [
    ...l.payments.map((p) => ({ key: p.id, at: p.paidAt ?? p.createdAt, kind: p.status === "paid" ? "Tahsilat" : `Online deneme · ${attemptLabel[p.status] ?? p.status}`, tone: (p.status === "paid" ? "success" : attemptTone[p.status] ?? "neutral") as Tone, detail: [methodName(p.method), p.reference].filter(Boolean).join(" · "), amount: p.amount, counted: p.status === "paid", note: p.refundedAmount > 0 ? `iade ${tryCurrency(p.refundedAmount)}` : "" })),
    ...l.refunds.map((r) => ({ key: r.id, at: r.refundedAt, kind: "İade", tone: "neutral" as Tone, detail: r.reason, amount: -r.amount, counted: true, note: "" })),
  ].sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? ""))) : [];
  return (
    <Panel title="Ödeme geçmişi" description={l ? `${l.payments.filter((p) => p.status === "paid").length} tahsilat · ${l.refunds.length} iade` : undefined} bodyClassName={rows.length ? "p-0" : undefined}>
      {!l ? loadingOrError(ledger)
        : !rows.length ? <EmptyState title="Ödeme kaydı yok" description="Ödeme sağlayıcısı aktif değil; alınan nakit, EFT veya POS tahsilatı elle kaydedilir." />
        : (
          <>
            <div className="hidden px-1 pb-1 md:block md:px-2">
              <Table>
                <TableHeader><TableRow><TableHead>Tarih</TableHead><TableHead>İşlem</TableHead><TableHead>Yöntem / referans / gerekçe</TableHead><TableHead className="text-right">Tutar</TableHead></TableRow></TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell>{trDate(r.at, true)}</TableCell>
                      <TableCell><StatusBadge tone={r.tone}>{r.kind}</StatusBadge></TableCell>
                      <TableCell className="whitespace-normal">{r.detail || "—"}{r.note && <span className="text-muted-foreground"> · {r.note}</span>}</TableCell>
                      <TableCell className={r.counted ? "text-right tabular-nums" : "text-right tabular-nums text-muted-foreground line-through"}>{tryCurrency(r.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y md:hidden">
              {rows.map((r) => (
                <li key={r.key} className="grid gap-1 p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2"><StatusBadge tone={r.tone}>{r.kind}</StatusBadge><span className={r.counted ? "font-medium tabular-nums" : "tabular-nums text-muted-foreground line-through"}>{tryCurrency(r.amount)}</span></div>
                  <p>{r.detail || "—"}{r.note && <span className="text-muted-foreground"> · {r.note}</span>}</p>
                  <p className="text-xs text-muted-foreground">{trDate(r.at, true)}</p>
                </li>
              ))}
            </ul>
          </>
        )}
    </Panel>
  );
}

const refundablePayments = (l: Ledger) => l.payments.filter((p) => p.status === "paid" && p.method !== "online" && p.amount - p.refundedAmount > 0);
const collectable = (l: Ledger) => !isClosed(l) && l.outstanding > 0;
/** How many entry cards PaymentActionPanels renders, so the page can size the controls row without gaps. */
export const paymentActionCount = (l: Ledger | null) => (l ? Number(collectable(l)) + Number(refundablePayments(l).length > 0) : 0);

/** Collection and refund entry cards. Returned as separate panels so the page can lay them out beside the status card. */
export function PaymentActionPanels({ orderId, ledger, onChanged }: { orderId: string; ledger: Ledger; onChanged: () => void }) {
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<string>("bank_transfer");
  const [payReference, setPayReference] = useState("");
  const [payKey, setPayKey] = useState(() => crypto.randomUUID());
  const [refundPayment, setRefundPayment] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundKey, setRefundKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);

  const refundable = refundablePayments(ledger);
  const canCollect = collectable(ledger);

  async function savePayment() {
    const amount = Number(payAmount);
    if (!Number.isInteger(amount) || amount <= 0) return toast.error("Tutarı tam TL olarak girin.");
    setBusy(true);
    const r = await postIdempotent(`/api/admin/orders/${orderId}/payments`, payKey, { amount, method: payMethod, reference: payReference.trim() });
    setBusy(false);
    if (r.definitive) setPayKey(crypto.randomUUID());
    if (!r.ok) return toast.error(r.error);
    toast.success("Ödeme kaydedildi.");
    setPayAmount(""); setPayReference(""); onChanged();
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
    setRefundAmount(""); setRefundReason(""); setRefundPayment(""); onChanged();
  }

  return (
    <>
      {canCollect && (
        <Panel title="Tahsilat kaydet" description={`Kalan bakiye: ${tryCurrency(ledger.outstanding)}`}>
          <fieldset className="grid gap-3" disabled={busy}>
            <legend className="sr-only">Tahsilat kaydet</legend>
            <FormField label="Tutar (TL)" htmlFor="pay-amount">
              <Input id="pay-amount" inputMode="numeric" value={payAmount} onChange={(e) => setPayAmount(e.target.value.replace(/\D/g, ""))} placeholder={String(ledger.outstanding)} />
            </FormField>
            <FormField label="Yöntem" htmlFor="pay-method">
              <select id="pay-method" className={selectClass} value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>{manualPaymentMethods.map((m) => <option key={m} value={m}>{paymentMethodLabel[m]}</option>)}</select>
            </FormField>
            <FormField label="Referans (dekont / slip no)" htmlFor="pay-reference">
              <Input id="pay-reference" maxLength={100} value={payReference} onChange={(e) => setPayReference(e.target.value)} />
            </FormField>
            <Button type="button" onClick={() => void savePayment()}>Ödemeyi kaydet</Button>
          </fieldset>
        </Panel>
      )}
      {refundable.length > 0 && (
        <Panel title="İade kaydet" description="Müşteriye geri ödenmiş parayı kaydeder; ödeme sağlayıcısında işlem yapmaz ve stok değiştirmez.">
          <fieldset className="grid gap-3" disabled={busy}>
            <legend className="sr-only">İade kaydet</legend>
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
        </Panel>
      )}
    </>
  );
}
