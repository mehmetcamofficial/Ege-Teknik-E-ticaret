import type { PublicLegalVersion, LegalVersionStatus } from "@/lib/legal";

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const dateTr = (date: Date) => new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "Europe/Istanbul" }).format(date);
const statusText: Record<LegalVersionStatus, string> = { effective: "Yürürlükte olan güncel sürüm", scheduled: "İleri tarihte yürürlüğe girecek sürüm", superseded: "Bu sürümün yerini daha yeni bir sürüm almıştır (arşiv görünümü)" };

/** Plain text only: everything is escaped; blank lines split paragraphs, single newlines become <br>. */
export function renderLegalBody(body: string): string {
  return body.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((block) => block.trim()).filter(Boolean).map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`).join("");
}

const shell = (title: string, robots: string, main: string) => `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="${robots}"><title>${escapeHtml(title)} | Ege Teknik</title><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet"><link rel="stylesheet" href="/store.css"><link rel="stylesheet" href="/phase1.css"></head><body class="store"><div data-site-header></div><main class="store-shell policy">${main}</main><div data-site-footer></div><script src="/store.js"></script></body></html>`;

export function renderLegalPage(version: PublicLegalVersion, status: LegalVersionStatus, exact: boolean): string {
  const meta = `<p class="notice"><b>Sürüm ${version.version}</b> · ${statusText[status]}<br>Yürürlük tarihi: ${dateTr(version.effectiveAt)} · Yayın tarihi: ${dateTr(version.publishedAt)}<br><small>İçerik özeti (SHA-256): ${escapeHtml(version.contentHash)}</small></p>`;
  const current = exact && status !== "effective" ? `<p><a href="/legal/${encodeURIComponent(version.slug)}">Güncel sürümü görüntüle</a></p>` : "";
  return shell(version.title, exact ? "noindex" : "index,follow", `<h1>${escapeHtml(version.title)}</h1>${meta}${current}<article>${renderLegalBody(version.body)}</article><p><a href="/policies.html">Tüm yasal metinler</a></p>`);
}

export function renderLegalNotFound(): string {
  return shell("Yasal metin bulunamadı", "noindex", `<h1>Yasal metin bulunamadı</h1><p>İstenen yasal metin veya sürüm yayında değil.</p><p><a href="/policies.html">Tüm yasal metinler</a></p>`);
}

export const legalHtmlHeaders = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } as const;

/** Admin-only preview (any state). Clearly bannered; never served from a public route. */
export function renderLegalDraftPreview(version: { title: string; body: string; version: number; publishedAt: Date | null }): string {
  const banner = version.publishedAt === null ? "TASLAK ÖNİZLEME — YAYINLANMAMIŞTIR" : "YAYINLANMIŞ SÜRÜM ÖNİZLEMESİ";
  return shell(version.title, "noindex", `<div class="notice"><b>${banner}</b> · Sürüm ${version.version}</div><h1>${escapeHtml(version.title)}</h1><article>${renderLegalBody(version.body)}</article>`);
}
