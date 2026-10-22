/**
 * H5-A: pure e-mail rendering for order notifications. No I/O, no environment, no server-only imports, so it is
 * unit-testable. Every interpolated value is HTML-escaped in the HTML part; the text part carries the same facts.
 *
 * Truthfulness rules (tested): the customer mail says the order was RECEIVED and that payment was NOT collected.
 * It never says paid, shipped, scheduled or installed, and it states no delivery date.
 */
export type OrderEmailItem = { productName: string; quantity: number; unitPrice: number; lineTotal: number };
export type OrderEmailData = {
  orderNumber: string;
  createdAt: Date;
  items: readonly OrderEmailItem[];
  subtotal: number; vatTotal: number; shippingTotal: number; installationTotal: number; total: number;
  customerName: string;
  deliveryMethod: "dealer" | "pickup" | "shipping" | string;
  installationIncluded: boolean;
  city: string; district: string;
  paymentStatus: string; status: string;
};
export type Rendered = { subject: string; text: string; html: string };
export type SiteLinks = { siteOrigin: string; adminOrigin?: string };

export const COMPANY = { name: "Ege Teknik", phone: "0542 795 75 60", email: "info@egeteknik.tr" } as const;

const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, (c) => entities[c]);
/** Header-injection guard: a subject/name can never carry a line break. */
export const oneLine = (value: unknown): string => String(value ?? "").replace(/[\r\n\u2028\u2029]+/g, " ").trim();

export const formatTry = (amount: number): string => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(amount);
const istanbul = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "long", timeStyle: "short" });
export const formatWhen = (date: Date): string => istanbul.format(date);

/** a***@d***.com — enough to recognise, never enough to reuse. Used for every log and audit line. */
export function maskEmail(address: string): string {
  const [local = "", domain = ""] = String(address ?? "").split("@");
  if (!local || !domain) return "***";
  const [host, ...rest] = domain.split(".");
  return `${local[0]}***@${host?.[0] ?? ""}***${rest.length ? "." + rest.join(".") : ""}`;
}

function deliverySummary(o: OrderEmailData): string {
  const where = [o.district, o.city].filter(Boolean).join(" / ");
  if (o.deliveryMethod === "pickup") return "Mağazadan teslim";
  if (o.deliveryMethod === "shipping") return `Kargo${where ? ` · ${where}` : ""}`;
  return `Adrese teslim${where ? ` · ${where}` : ""}${o.installationIncluded ? " · Standart montaj dahil" : ""}`;
}

const trackingLine = (links: SiteLinks) => `${links.siteOrigin.replace(/\/$/, "")}/order-lookup.html`;

export function renderCustomerOrderReceived(o: OrderEmailData, links: SiteLinks): Rendered {
  const subject = `Siparişiniz alındı — ${oneLine(o.orderNumber)}`;
  const lines = o.items.map((i) => `- ${oneLine(i.productName)} × ${i.quantity} — ${formatTry(i.lineTotal)}`);
  const text = [
    `Merhaba ${oneLine(o.customerName)},`,
    "",
    `${COMPANY.name} siparişinizi aldı. Sipariş numaranız: ${oneLine(o.orderNumber)}`,
    "",
    "Ürünler:", ...lines, "",
    `Sipariş tutarı (KDV dahil): ${formatTry(o.total)}`,
    "Ödeme durumu: Tahsil edilmedi. Bu sipariş için ödeme alınmadı; ödeme yöntemi ayrıca sizinle netleştirilir.",
    `Teslimat: ${deliverySummary(o)}`,
    "Teslimat ve montaj için kesinleşmiş bir tarih bu e-postada verilmemiştir.",
    "",
    `Siparişinizi, sipariş numaranız ve sipariş verirken kullandığınız e-posta adresiyle görüntüleyebilirsiniz: ${trackingLine(links)}`,
    "",
    `Sorularınız için: ${COMPANY.phone} · ${COMPANY.email}`,
    COMPANY.name,
  ].join("\n");
  const rows = o.items.map((i) => `<tr><td style="padding:6px 0">${escapeHtml(i.productName)}</td><td style="padding:6px 12px;text-align:right">${i.quantity}</td><td style="padding:6px 0;text-align:right">${escapeHtml(formatTry(i.lineTotal))}</td></tr>`).join("");
  const html = `<!doctype html><html lang="tr"><body style="font-family:Arial,sans-serif;color:#1f2a25;line-height:1.5;max-width:560px;margin:0 auto;padding:16px">
<h1 style="font-size:20px;margin:0 0 12px">Siparişiniz alındı</h1>
<p>Merhaba ${escapeHtml(oneLine(o.customerName))},</p>
<p>${escapeHtml(COMPANY.name)} siparişinizi aldı. Sipariş numaranız: <strong>${escapeHtml(oneLine(o.orderNumber))}</strong></p>
<table role="presentation" style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left">Ürün</th><th style="text-align:right;padding:0 12px">Adet</th><th style="text-align:right">Tutar</th></tr></thead><tbody>${rows}</tbody></table>
<p><strong>Sipariş tutarı (KDV dahil): ${escapeHtml(formatTry(o.total))}</strong></p>
<p style="background:#fff7e6;border:1px solid #e9cfa9;padding:10px;border-radius:8px"><strong>Ödeme durumu: Tahsil edilmedi.</strong> Bu sipariş için ödeme alınmadı; ödeme yöntemi ayrıca sizinle netleştirilir.</p>
<p>Teslimat: ${escapeHtml(deliverySummary(o))}<br>Teslimat ve montaj için kesinleşmiş bir tarih bu e-postada verilmemiştir.</p>
<p>Siparişinizi, sipariş numaranız ve sipariş verirken kullandığınız e-posta adresiyle <a href="${escapeHtml(trackingLine(links))}">buradan görüntüleyebilirsiniz</a>.</p>
<p>Sorularınız için: ${escapeHtml(COMPANY.phone)} · <a href="mailto:${escapeHtml(COMPANY.email)}">${escapeHtml(COMPANY.email)}</a><br>${escapeHtml(COMPANY.name)}</p></body></html>`;
  return { subject, text, html };
}

export function renderAdminNewOrder(o: OrderEmailData & { orderId: string }, links: SiteLinks): Rendered {
  const adminLink = links.adminOrigin ? `${links.adminOrigin.replace(/\/$/, "")}/admin/orders/${encodeURIComponent(o.orderId)}` : "";
  const subject = `Yeni sipariş ${oneLine(o.orderNumber)} — ${formatTry(o.total)} — ödeme: ${paymentLabel(o.paymentStatus)}`;
  const text = [
    "Yeni bir sipariş oluşturuldu.", "",
    `Sipariş no: ${oneLine(o.orderNumber)}`,
    `Toplam: ${formatTry(o.total)} (KDV dahil)`,
    `Zaman: ${formatWhen(o.createdAt)}`,
    `Ödeme durumu: ${paymentLabel(o.paymentStatus)}`,
    `Ürün kalemi: ${o.items.length}`,
    adminLink ? `Sipariş detayı: ${adminLink}` : "Sipariş detayı: yönetim panelinden sipariş numarasıyla bulunur.",
    "", "Müşteri bilgileri bu e-postada yer almaz; yönetim panelinde görüntülenir.",
  ].join("\n");
  const html = `<!doctype html><html lang="tr"><body style="font-family:Arial,sans-serif;color:#1f2a25;line-height:1.5"><h1 style="font-size:18px">Yeni sipariş</h1>
<ul><li>Sipariş no: <strong>${escapeHtml(oneLine(o.orderNumber))}</strong></li><li>Toplam: ${escapeHtml(formatTry(o.total))} (KDV dahil)</li><li>Zaman: ${escapeHtml(formatWhen(o.createdAt))}</li><li>Ödeme durumu: ${escapeHtml(paymentLabel(o.paymentStatus))}</li><li>Ürün kalemi: ${o.items.length}</li></ul>
${adminLink ? `<p><a href="${escapeHtml(adminLink)}">Sipariş detayını aç</a></p>` : "<p>Sipariş detayı yönetim panelinden sipariş numarasıyla bulunur.</p>"}
<p style="color:#59615b">Müşteri bilgileri bu e-postada yer almaz; yönetim panelinde görüntülenir.</p></body></html>`;
  return { subject, text, html };
}

const paymentLabels: Record<string, string> = { pending: "Tahsil edilmedi", partially_paid: "Kısmen tahsil edildi", paid: "Tahsil edildi", failed: "Başarısız", cancelled: "İptal", refunded: "İade edildi", partially_refunded: "Kısmen iade edildi" };
export const paymentLabel = (status: string): string => paymentLabels[status] ?? status;
