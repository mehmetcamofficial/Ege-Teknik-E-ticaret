/** H5-A: pure description of the admin "new orders / notification health" banner (unit-tested, no React). */
export type OperationsSummary = {
  orders: { awaitingPayment: number; last24h: number; newestAt: string | null };
  notifications: { providerConfigured: boolean; providerReason: string | null; adminRecipientsConfigured: boolean; byStatus: Record<string, number>; oldestWaitingSeconds: number | null };
};
export type Banner = { tone: "ok" | "warning" | "danger"; headline: string; details: string[] };

export function describeNotifications(s: OperationsSummary["notifications"]): Banner {
  const waiting = (s.byStatus.pending ?? 0) + (s.byStatus.sending ?? 0), dead = s.byStatus.dead ?? 0;
  const details: string[] = [];
  if (!s.providerConfigured) {
    details.push(`E-posta servisi yapılandırılmamış${s.providerReason ? ` (${s.providerReason})` : ""}.`);
    details.push(waiting ? `${waiting} bildirim kuyrukta bekliyor; yapılandırma yapılana kadar gönderilmeyecek.` : "Yeni siparişlerde bildirim kuyruğa alınır ama gönderilmez.");
    details.push("Müşteriye otomatik e-posta GİTMİYOR; siparişleri panelden takip edin.");
    return { tone: "danger", headline: "E-posta bildirimleri devre dışı", details };
  }
  if (!s.adminRecipientsConfigured) details.push("ORDER_ALERT_EMAILS tanımlı değil; yönetici bildirimi yalnızca aktif süper yönetici/operasyon yöneticisi hesaplarına gider.");
  if (dead) details.push(`${dead} bildirim gönderilemedi (kalıcı hata). Ayrıntı için denetim kaydına bakın.`);
  if (waiting) details.push(`${waiting} bildirim gönderilmeyi bekliyor${s.oldestWaitingSeconds && s.oldestWaitingSeconds > 900 ? ` (en eskisi ${Math.round(s.oldestWaitingSeconds / 60)} dk)` : ""}.`);
  return { tone: dead ? "danger" : waiting && (s.oldestWaitingSeconds ?? 0) > 900 ? "warning" : "ok", headline: dead ? "Bazı bildirimler gönderilemedi" : "E-posta bildirimleri çalışıyor", details };
}

export function describeOrders(o: OperationsSummary["orders"]): string[] {
  return [`Ödeme bekleyen sipariş: ${o.awaitingPayment}`, `Son 24 saatte yeni sipariş: ${o.last24h}`];
}
