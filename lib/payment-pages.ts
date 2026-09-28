/**
 * Customer payment pages (Phase 3.3B prep): /payment, /payment/success, /payment/fail. Server-rendered HTML with NO
 * script at all, so they run under the site's existing strict CSP unchanged. Every dynamic value is escaped. No card
 * field exists anywhere: card data is entered only inside PayTR's own iframe.
 *
 * NOTE for the Preview integration step: the iframe page needs PayTR's exact origin in frame-src (default-src 'self'
 * blocks it today, on purpose). That CSP change is deliberately NOT made while PAYTR_ENABLED is off.
 */
const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const paymentHtmlHeaders = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" } as const;

function layout(title: string, body: string, opts: { refreshSeconds?: number } = {}) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">${opts.refreshSeconds ? `<meta http-equiv="refresh" content="${opts.refreshSeconds}">` : ""}<title>${esc(title)} | Ege Teknik</title>
<style>body{margin:0;background:#f4fbf9;color:#161d1c;font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:720px;margin:0 auto;padding:32px 16px 56px}.brand{font-weight:800;color:#0f382e;letter-spacing:.02em;text-decoration:none}h1{color:#0f382e;font-size:26px;margin:24px 0 8px}.card{background:#fff;border:1px solid #dce7e3;border-radius:14px;padding:20px;margin-top:16px}.muted{color:#5d6864;font-size:14px}.notice{background:#fff7e8;border:1px solid #f3d7a4;color:#7c4700;border-radius:10px;padding:12px 14px;margin-top:16px}.ok{background:#ecfdf5;border-color:#a7f3d0;color:#065f46}label{display:grid;gap:6px;font-weight:600;font-size:14px;margin-top:12px}input{font:inherit;min-height:46px;padding:0 12px;border:1px solid #dce7e3;border-radius:9px}button,.button{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:0 18px;border:0;border-radius:10px;background:#0f382e;color:#fff;font:inherit;font-weight:700;text-decoration:none;margin-top:16px;cursor:pointer}.button.ghost{background:#eef5f3;color:#0f382e}.actions{display:flex;flex-wrap:wrap;gap:10px}iframe{width:100%;min-height:640px;border:0;border-radius:12px;background:#fff}</style></head>
<body><main><a class="brand" href="/">EGE TEKNİK</a>${body}</main></body></html>`;
}

export function renderPaymentUnavailable(): string {
  return layout("Online ödeme", `<h1>Online ödeme şu anda kullanılamıyor</h1><div class="card"><p>Siparişiniz kayıtlıdır. Ödeme adımı için sizinle iletişime geçeceğiz.</p><p class="muted">Sorularınız için 0542 795 75 60 veya info@egeteknik.tr</p><div class="actions"><a class="button ghost" href="/">Ana sayfaya dön</a></div></div>`);
}

export function renderPaymentForm(input: { orderNumber?: string; error?: string }): string {
  return layout("Online ödeme", `<h1>Siparişinizin ödemesi</h1><p class="muted">Sipariş numaranızı ve siparişte kullandığınız e-posta adresini girin. Kart bilgileriniz Ege Teknik'e iletilmez; ödeme PayTR'nin güvenli sayfasında yapılır.</p>
${input.error ? `<p class="notice" role="alert">${esc(input.error)}</p>` : ""}
<form class="card" method="post" action="/payment"><label>Sipariş numarası<input name="orderNumber" required maxlength="40" autocomplete="off" value="${esc(input.orderNumber ?? "")}"></label><label>E-posta<input name="email" type="email" required maxlength="150" autocomplete="email"></label><button type="submit">Ödemeye geç</button></form>`);
}

export function renderPaymentFrame(input: { iframeUrl: string; orderNumber: string }): string {
  return layout("Güvenli ödeme", `<h1>Güvenli ödeme</h1><p class="muted">Sipariş ${esc(input.orderNumber)} · Kart bilgileriniz yalnızca PayTR'nin güvenli sayfasına girilir.</p><div class="card"><iframe src="${esc(input.iframeUrl)}" title="PayTR güvenli ödeme" referrerpolicy="no-referrer"></iframe></div>`);
}

/**
 * Result pages read the attempt's REAL state (set only by the verified callback). Arriving here is never proof of
 * payment: a pending attempt says "doğrulanıyor" and refreshes itself without JavaScript.
 */
export function renderPaymentResult(input: { page: "success" | "fail"; attempt: { orderNumber: string; status: string } | null }): string {
  const a = input.attempt;
  const retry = a ? `/payment?order=${encodeURIComponent(a.orderNumber)}` : "/payment";
  if (a?.status === "paid") return layout("Ödeme alındı", `<h1>Ödemeniz alındı</h1><p class="notice ok">Sipariş ${esc(a.orderNumber)} için ödemeniz ödeme sağlayıcısı tarafından doğrulandı.</p><div class="actions"><a class="button ghost" href="/">Ana sayfaya dön</a></div>`);
  if (a && (a.status === "pending") && input.page === "success") return layout("Ödeme doğrulanıyor", `<h1>Ödeme sonucu doğrulanıyor</h1><div class="card"><p>Sipariş ${esc(a.orderNumber)} için ödeme sağlayıcısından onay bekleniyor. Bu sayfa birkaç saniyede bir kendini yeniler.</p><p class="muted">Onay gelmeden ödeme alınmış sayılmaz. Birkaç dakika içinde güncellenmezse bizimle iletişime geçin.</p></div>`, { refreshSeconds: 5 });
  return layout("Ödeme tamamlanamadı", `<h1>Ödeme tamamlanamadı</h1><div class="card"><p>Ödemeniz alınmadı${a ? ` (sipariş ${esc(a.orderNumber)})` : ""}. Siparişiniz silinmedi; tekrar deneyebilirsiniz.</p><p class="muted">Kartınızdan tutar çekildiğini düşünüyorsanız 0542 795 75 60 veya info@egeteknik.tr üzerinden bize ulaşın.</p><div class="actions"><a class="button" href="${esc(retry)}">Tekrar dene</a><a class="button ghost" href="/">Ana sayfaya dön</a></div></div>`);
}
