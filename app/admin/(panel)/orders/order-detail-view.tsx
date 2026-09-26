"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";

import { Button } from "@/components/ui/button";
import { EmptyState, FormField, Notice, PageHeader, Panel, StatusBadge, selectClass } from "@/components/admin/ui";
import { sendAdmin, useAdminJson, type Overview } from "@/components/admin/use-admin-data";
import { orderStatusLabel, orderStatusTone, paymentStatusLabel, trDate, tryCurrency } from "@/lib/admin-ui";
import { describeOrderDelivery } from "@/lib/order-delivery";

const crumbs = [{ href: "/admin/orders", label: "Siparişler" }];

/** Shows only fields the existing overview endpoint already returns for an order - nothing is derived or invented. */
export default function OrderDetailView({ orderId, canWrite }: { orderId: string; canWrite: boolean }) {
  const { data, error, loading, reload } = useAdminJson<Overview>("/api/admin/overview");
  const order = data?.orders.find((o) => o.id === orderId);
  const [nextStatus, setNextStatus] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  async function saveStatus(statusToSave?: string) {
    const target = statusToSave ?? nextStatus;
    if (!order || !target || target === order.status) return;
    const r = await sendAdmin(`/api/admin/orders/${order.id}`, "PATCH", { status: target });
    if (r.ok) {
      toast.success(`Sipariş durumu "${orderStatusLabel[target] ?? target}" olarak güncellendi.`);
      setMessage({ tone: "success", text: "Sipariş durumu güncellendi." });
      setNextStatus(null);
      reload();
    } else {
      toast.error(r.error || "Sipariş durumu güncellenemedi.");
      setMessage({ tone: "error", text: r.error || "Sipariş durumu güncellenemedi." });
    }
  }

  async function confirmCancel() {
    setCancelling(true);
    await saveStatus("cancelled");
    setCancelling(false);
    setCancelOpen(false);
  }

  if (!data) return <><PageHeader title="Sipariş" breadcrumb={crumbs} />{error ? <Notice tone="error">{error}</Notice> : loading ? <Notice tone="info">Yükleniyor…</Notice> : null}</>;
  if (!order) return <><PageHeader title="Sipariş" breadcrumb={crumbs} /><EmptyState title="Sipariş bulunamadı" description="Bu ekran en son 100 siparişi gösterebilir; bağlantı hatalı ya da sipariş daha eski olabilir." /></>;

  const selected = nextStatus ?? order.status;
  const delivery = describeOrderDelivery(order);
  // Shipping and installation only appear when the order actually charged them (new orders include installation in the product price).
  const totals: [string, number][] = [["Ara toplam", order.subtotal], ["KDV", order.vatTotal], ...(order.shippingTotal > 0 ? [["Kargo bedeli", order.shippingTotal] as [string, number]] : []), ...(order.installationTotal > 0 ? [["Montaj bedeli", order.installationTotal] as [string, number]] : [])];

  return (
    <>
      <PageHeader title={`Sipariş ${order.orderNumber}`} breadcrumb={crumbs} description={`Oluşturulma: ${trDate(order.createdAt, true)}`} actions={<StatusBadge tone={orderStatusTone[order.status] ?? "neutral"}>{orderStatusLabel[order.status] ?? order.status}</StatusBadge>} />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-6">
          <Panel title="Müşteri ve teslimat">
            <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Müşteri</dt><dd className="font-medium">{order.customerName}</dd></div>
              <div><dt className="text-muted-foreground">Telefon</dt><dd><a className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline" href={`tel:${order.phone}`}>{order.phone}</a></dd></div>
              <div><dt className="text-muted-foreground">E-posta</dt><dd className="break-all">{order.email ? <a className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline" href={`mailto:${order.email}`}>{order.email}</a> : "—"}</dd></div>
              <div><dt className="text-muted-foreground">İl</dt><dd>{delivery.province}</dd></div>
              <div><dt className="text-muted-foreground">İlçe</dt><dd>{delivery.district}</dd></div>
              <div className="sm:col-span-2"><dt className="text-muted-foreground">Adres</dt><dd className="whitespace-pre-line">{order.address || "—"}</dd></div>
              <div><dt className="text-muted-foreground">Teslimat yöntemi</dt><dd>{delivery.method}</dd></div>
              <div><dt className="text-muted-foreground">Teslimat bölgesi</dt><dd>{delivery.region}</dd></div>
              <div><dt className="text-muted-foreground">Kargo bedeli</dt><dd className="tabular-nums">{delivery.shippingFee === null ? "—" : tryCurrency(delivery.shippingFee)}</dd></div>
              <div><dt className="text-muted-foreground">Montaj</dt><dd>{delivery.installation}</dd></div>
              {order.notes && <div className="sm:col-span-2"><dt className="text-muted-foreground">Sipariş notu</dt><dd className="whitespace-pre-line">{order.notes}</dd></div>}
            </dl>
            {!delivery.hasSnapshot && <p className="mt-3 text-xs text-muted-foreground">Bu sipariş teslimat modeli güncellenmeden önce oluşturulmuş; yeni teslimat alanları kayıtlı değil.</p>}
          </Panel>
          <p className="text-sm text-muted-foreground">Sipariş kalemleri bu ekranda henüz listelenmiyor; mevcut yönetim verisi yalnızca sipariş özetini içeriyor.</p>
        </div>
        <div className="grid min-w-0 content-start gap-6">
          <Panel title="Tutar">
            <dl className="grid gap-2 text-sm">
              {totals.map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="tabular-nums">{tryCurrency(value)}</dd></div>)}
              <div className="mt-1 flex justify-between gap-3 border-t pt-2 font-semibold"><dt>Toplam</dt><dd className="tabular-nums">{tryCurrency(order.total)}</dd></div>
              <div className="flex justify-between gap-3 pt-1"><dt className="text-muted-foreground">Ödeme durumu</dt><dd>{paymentStatusLabel[order.paymentStatus] ?? order.paymentStatus}</dd></div>
            </dl>
          </Panel>
          {canWrite && (
            <Panel title="Durumu güncelle">
              <div className="grid gap-3">
                <FormField label="Sipariş durumu" htmlFor="order-next-status">
                  <select id="order-next-status" className={selectClass} value={selected} onChange={(e) => setNextStatus(e.target.value)}>{Object.entries(orderStatusLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                </FormField>
                <div className="flex flex-col gap-2">
                  <Button type="button" onClick={() => void saveStatus()} disabled={selected === order.status}>Durumu kaydet</Button>
                  {order.status !== "cancelled" && order.status !== "delivered" && (
                    <Button type="button" variant="outline" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setCancelOpen(true)}>
                      Siparişi iptal et
                    </Button>
                  )}
                </div>
              </div>
            </Panel>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Sipariş İptal Onayı"
        description={
          <span>
            <strong>{order.orderNumber}</strong> numaralı siparişi iptal etmek istediğinizden emin misiniz?
            <br />
            <span className="mt-1 block text-xs text-muted-foreground">
              Not: İptal edilen siparişler finansal/yasal denetim için veritabanında saklanır ve hard-delete edilmez.
            </span>
          </span>
        }
        confirmLabel="Evet, İptal Et"
        cancelLabel="Vazgeç"
        variant="destructive"
        loading={cancelling}
        onConfirm={confirmCancel}
      />
    </>
  );
}
