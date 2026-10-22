# H3.1 — Checkout final polish kabul kaydı (2026-10-22)

Branch `feature/hybrid-h3-1-checkout-final-polish`, H3 `c14d08e` üzerinden.
Uygulama kodu Preview'da: `e21ad8d` → `dpl_52Xqe9CtnBiyJVKasn7y4t9WEbFx` (Ready, preview). Sonraki commit'ler yalnızca test betiği ve kanıt içerir.

## Üç ifadenin kaynağı (H3.1-B)
| İfade | Kaynak | Müşteriye gider mi? |
|---|---|---|
| `ETS-H3-SYNTH` | Yalnızca H3 kabul betiğindeki yakalanmış (intercepted) sahte sipariş numarası | Hayır. Uygulama kodunda yok; artık `TEST-SENTETIK-SIPARIS` ve tek test modülünde (`scripts/fixtures/h31-synthetic-legal.mjs`) |
| `Sürüm undefined` | H3 test taklidi: gerçek `/api/legal/required` `version` taşımaz, taklit `d.version` yazdı. İstemci de eksik sürümü korumasız yazdırıyordu | Düzeltildi: sürüm etiketi yalnızca pozitif tam sayıda; eksik/geçersiz sürüm gösterilmez, geçersiz önizleme siparişi engeller |
| `PREVIEW RENDER TEST — NOT LEGAL TEXT` | Sunucuya gömülü, yalnızca doğrulanmış Preview kimliğiyle sunulan ayrılmış fixture (`lib/legal-fixture-registry.ts`); sipariş bağlaması bu id'leri reddeder; Production'da `null` | Yalnızca Preview. Değiştirilmedi, yayınlanmadı |

## Düzeltme notu
H3 raporunda "Preview'da KVKK uyarısı görünüyor" demiştim; o uyarı yerel test taklidinden geliyordu. Hosted Preview'un
`/api/legal/documents` yanıtında `kvkk` kaydı vardır, ancak bu bir eski fixture'dır ("PREVIEW TEST — kvkk — NOT LEGAL TEXT — DO NOT COPY TO PRODUCTION").
`/api/legal/documents` ayrıca `cookies` (DRAFT — LEGAL REVIEW REQUIRED) fixture'ını da listeliyor.

## Sonuçlar
Hosted H3.1 15/15 (60 axe, min kontrast 6,39:1), hosted H3 15/15, H2/H2.1 15/15, H1.2 15/15; yerel H3.1 / H3 / H2 / H1.2 15/15 × 4.
Birim 1612/0, tsc/lint/build/gitleaks temiz. Tüm koşularda 90 POST test tarafından yanıtlandı, gerçek yazma 0, sipariş oluşturulmadı.
Disposable PostgreSQL gerekmedi (sunucu sözleşmesi değişmedi; H3 kanıtları `docs/hybrid-h3/evidence/server`).
