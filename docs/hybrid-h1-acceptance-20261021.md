# H1 — Hibrit premium ana sayfa kabulü

Tarih: 21.10.2026. **Teknik H1: PASS. Görsel kullanıcı kabulü: BEKLİYOR.** H2–H4 başlatılmadı. Bu sonuç Production yayın onayı değildir.

## Kaynak ve kapsam

- Korunan dal: `complete-release-backup-final`; doğrulanmış kaynak: `4f70b08264f1c4cef96df47496e00f05c4637593`.
- Bağımsız kalıcı çalışma alanı: `~/Developer/ege-teknik-hybrid-h1`.
- Feature dalı: `feature/hybrid-storefront-h1`.
- GitHub dalı: https://github.com/mehmetcamofficial/Ege-Teknik-E-ticaret/tree/feature/hybrid-storefront-h1 . Kesin gönderim SHA’sı ve remote eşleşmesi son teslimde ayrıca doğrulanır; bu rapor uygulamayla birlikte versiyonlanır.
- Canlı referans: https://egeteknik.tr/ . Anonim gerçek masaüstü/mobil tam ekran kayıtları [screenshots](hybrid-h1/screenshots/) altındaki `actual-live-*-full.png` dosyalarıdır.
- Premium Preview: `https://ege-teknik-phase3a-82icrwex7-dragonfire-09s-projects.vercel.app`; Vercel metadata SHA’sı kaynak commit’iyle eşleşir. Yetkili `vercel curl` GET HTML yanıtı kaynak `public/index.html` ile byte düzeyinde eşit bulundu.

Canlı alışveriş ana sayfasının tamamı referans alındı; korunan release’in header/footer, çerez/rıza yükleyicisi, metadata, sepet ve API kodu yeniden kullanıldı. Fiyat veya stok HTML’e gömülmedi. Veri kaynağı mevcut `GET /api/products`; test snapshot’ı 78 gerçek public üründen oluşur ve uygulamaya fallback veri olarak eklenmez.

## Korunan özellikler ve seçilen iyileştirmeler

| İşlev | Sonuç |
|---|---|
| Airy beyaz/siyah | Ayrı gerçek ürün id’si, görseli, adı, fiyatı, stoğu, detay bağlantısı ve sepet satırı birlikte değişiyor |
| Hero alışveriş | KDV dahil fiyat, mevcut stok, SKU yoksa `—`, detay ve sepete ekleme korunuyor |
| Slider / seri sekmeleri | Airy, Fairy, Pular & Aphro, seçici; önceki/sonraki, durdur/başlat ve klavye kontrolleri korunuyor |
| Ürün keşfi | Seri kartları, BTU/kategori yolları, sekiz ürünlük vitrin, bölge haritası, servis ve rehber bağlantıları korunuyor |
| Klima seçici | Mevcut B6 aşamalı motor ana sayfada da yeniden kullanılıyor; ayrı sahte hesap veya ürün listesi eklenmedi |
| API gecikmesi/hatası/boş sonuç | Loading durumu, yeniden erişim bağlantıları; doğrulanmamış üründe hero sepet eylemi kapalı |
| Görsel düzen | Daha sakin başlık ağırlığı, orantılı görsel, sınırlı boşluklar, aynı yerel font ve hareket token’ları; mobilde okunur seri etiketleri |

Model/indirim/yorum/garanti uydurulmadı. Yerel gerçek GREE görsel dosyaları değiştirilmedi. Yeni paket veya animasyon kütüphanesi eklenmedi. API, schema, hukuk, checkout, RBAC ve admin dosyaları değiştirilmedi.

## Test kanıtları

| Kontrol | Sonuç / kanıt |
|---|---|
| TypeScript | PASS — [log](hybrid-h1/evidence/typecheck.log) |
| Lint | PASS, 0 hata, 5 mevcut uyarı — [log](hybrid-h1/evidence/lint.log); H1 dosyaları 0 uyarı |
| Standart production build | PASS — doğrudan `next build`, font veya bundler alternatifi yok; yalnızca Sentry yükleme/telemetri kapalı — [log](hybrid-h1/evidence/build.log) |
| Regresyon | 1554 PASS, 0 FAIL, 77 SKIP — [özet](hybrid-h1/evidence/test-summary.txt) |
| Yeni hero davranışı | 6/6 PASS: loading, unavailable, missing, sold-out, quote, available |
| Chrome 155.0.8059.85 | 320/375/768/1024/1440 px PASS |
| Firefox 157.0 | 320/375/768/1024/1440 px PASS |
| WebKit 27.2 | 320/375/768/1024/1440 px PASS; gerçek Safari olarak adlandırılmadı |
| Axe | 69 tam akış taraması + son CSS sonrası 15 tarama: 84/84, 0 ihlal; WCAG 2 A/AA, 2.1 A/AA ve 2.2 AA etiketleri |
| Etkileşimler | Renk, fiyat/stok, sepet, seri/kapasite URL’leri, geri/ileri, slider inert/focus, skip-link, menü Escape/odak, reduced-motion PASS |
| Ek müşteri akışları | Ürün detayına tıklama/render, sepet özeti, arama: üç motor × mobil/masaüstü = 6/6 PASS — [kayıt](hybrid-h1/evidence/journeys.json) |
| Son responsive düzen | Üç motor × beş genişlik = 15/15 PASS; taşma yok, kontrollerin hedef boyutu ve görünür klavye odağı doğrulandı — [kayıt](hybrid-h1/evidence/final-layout.json) |

DB gerektiren 77 test bu frontend kapsamlı H1’de çalıştırılmadı ve PASS sayılmadı. Ürün detay testinde değişmeyen HTML template ve gerçek public detay GET fixture’ı kullanıldı; SSR ürün SEO’su, ödeme ve gerçek checkout POST/persistence testi yapılmadı. Fiyat/stok/ürün eşleşmeleri değiştirilmemiş public yanıtla kontrol edildi. Testteki API hata/empty/latency durumları yerel route fixture’larıdır. Gerçek sipariş veya servis kaydı oluşturulmadı.

İlk WebKit HTTP denemesi başarısızdı: CSP `upgrade-insecure-requests`, yerel HTTP kaynaklarını TLS olmayan porta yükseltti. [İlk kayıt](hybrid-h1/evidence/http-first-attempt.json) bu başarısızlığı ve tamamlanan Chrome/Firefox sonuçlarını korur. Uygulama politikası değiştirilmedi; WebKit, son responsive kapı ve altı ek müşteri akışı localhost HTTPS relay üzerinde çalıştırıldı. Self-signed sertifika istisnası yalnız test browser context’ine aittir. [WebKit HTTPS kanıtı](hybrid-h1/evidence/webkit-https.json).

İlk regresyondaki eski statik premium hero beklentileri, geri getirilen dört slayt/renk/sepet sözleşmesini doğrulayacak şekilde güncellendi; davranış testleri kaldırılmadı. `hybrid-home.css` adının eski `home.css` yasağına isimden takılması yeni dosyanın `hybrid-storefront.css` olarak adlandırılmasıyla giderildi. Dış font eklenmedi.

## Görsel karşılaştırma

[Karşılaştırma galerisi](hybrid-h1/comparison.html) · [Masaüstü üçlü](hybrid-h1/screenshots/comparison-desktop.png) · [Mobil üçlü](hybrid-h1/screenshots/comparison-mobile.png).

Koşullar: aynı Chrome, 960 px yükseklik, aynı public katalog snapshot’ı, boş sepet, analitik reddedilmiş, reduced-motion açık. Canlı ve doğrulanmış premium HTML yerelde render edildi; bunlar hosted tarayıcı kabulü olarak sunulmuyor. Ayrıca anonim gerçek canlı site ekranları ayrı saklandı.

| Genişlik | Canlı hero yüksekliği | Premium | H1 | Canlıya göre fark |
|---|---:|---:|---:|---:|
| 375 | 674 px | 775 px | 691 px | +17 px |
| 768 | 669 px | 613 px | 679 px | +10 px |
| 1440 | 741 px | 642 px | 673 px | −68 px |

Masaüstü başlık boyutu canlıda 54, premiumda 68, H1’de 46 px. Mobilde 28 px korunur. Mobil/tablet yükseklik artışları gizlenmemiştir; görünür seri etiketleri ve 44 px yüksekliğinde erişilebilir kontroller tutulur. H1 her üç ölçümde canlıdaki iki renk ve dört sekmeyi korur; premium hero bunları içermiyordu. Bunlar geometri ölçümüdür, Core Web Vitals veya dönüşüm kazanımı değildir. LCP/INP/CLS ve saha dönüşümü bu H1 kapsamında ölçülmedi: UNKNOWN.

## Değişen dosyalar ve tekrar çalıştırma

- `public/index.html`, yeni `public/hybrid-storefront.css`, `public/store-core.js` (hero loading/error/missing eylem kilidi).
- `tests/hybrid-home-h1.test.ts`, `tests/storefront-package-1e.test.ts`, `tests/storefront-design-quality.test.ts`.
- `scripts/test-hybrid-home-h1.mjs`, `scripts/test-hybrid-home-journeys.mjs`, `scripts/test-hybrid-home-layout.mjs`.
- Bu rapor ve `docs/hybrid-h1/` karşılaştırma/kanıt dosyaları.

Kalite: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `LOCAL_BUILD_NO_UPLOAD=1 NEXT_TELEMETRY_DISABLED=1 pnpm build`.

Tarayıcı betikleri `EGE_BROWSER_TOOLS` ile harici Playwright/axe araçlarına, `PLAYWRIGHT_BROWSERS_PATH` ile motorlara, `EGE_H1_INPUT` ile public GET snapshot dizinine erişir. Varsayılan snapshot dizini `.scratch/h1/inputs` içinde `catalog.json`, `airy-detail.json`, `live.html`, `premium.html` bulunur. Snapshot’lar, TLS anahtarı ve geçici browser araçları Git dışında tutulur. WebKit için yerel HTTPS origin’i `EGE_H1_ORIGIN=https://127.0.0.1:44387` seçilir. Bütünüyle tekrar için `test-hybrid-home-h1.mjs`, ek yollar için `test-hybrid-home-journeys.mjs`, son layout için `test-hybrid-home-layout.mjs` çalıştırılır.

Gitleaks v8.30.1 korunan kaynak geçmişinde ve stage edilmiş H1 diff’inde 0 bulgu verdi; hiçbir kural/bulgu bastırılmadı. Yasak env/dump/key/backup dosyası bulunmadı — [güvenlik kaydı](hybrid-h1/evidence/security.json). Commit sonrası tam geçmiş ve remote SHA eşleşmesi ayrıca gönderim kapısıdır; gizli değerler rapora yazılmaz. Korunan release ve önceki çalışma ağaçları değiştirilmedi. Production deploy, migration ve main merge yapılmadı. H1’in görsel onayı olmadan H2–H4’e geçilmez.
