# H1.1 UX & Cart Drawer — kabul raporu

Tarih: 21.10.2026. **Teknik kabul PASS; kullanıcı görsel kabulü BEKLİYOR.** Sonraki tasarım aşamasına geçilmedi. Production yayını yapılmadı.

## Kaynak ve teslim

- Kalıcı alan: `~/Developer/ege-teknik-hybrid-h1-1`; dal: `feature/hybrid-h1-1-cart-ux`.
- Doğrulanmış H1 kaynağı: `ed93910bf282c67890514ed9c180031a24eefc1d`.
- Korunan release: `4f70b08264f1c4cef96df47496e00f05c4637593` (`complete-release-backup-final`).
- Test edilen uygulama commit'i: `a6b9cbc524ffadccc8a2a33e9630d5995a1aae92`.
- [Test edilen READY Preview](https://ege-teknik-phase3a-dkumngr4h-dragonfire-09s-projects.vercel.app). Vercel erişim koruması devam eder. CLI tarafından sağlanan yalnız bu hosta ait oturum çerezi özel, Git dışı dosyada kullanıldı; koruma kapatılmadı, ortam secret'ları okunmadı.
- Son teslim commit'i kanıt, rapor ve hosted test betiğini içerir; uygulama kabulü yukarıdaki değişmez commit üzerinde yapıldı. Nihai SHA Git geçmişinden doğrulanır.

## Uygulama

Seçici açık yüzeylerindeki başlık, açıklama, checklist/legend ve ghost buton kontrastı düzeltildi; sonuç kartları mobil grid'e uyarlandı. Hesaplama kodu H1 ile byte düzeyinde aynı: SHA-256 `d2faee5001a73bfd7ea6823493c7574863a2536b684045315162612a950b549b`.

Drawer mevcut `ege-cart` / `writeCart` sınırını kullanır. Paralel sepet yoktur. Güncel katalogdan fiyat, stok ve satış uygunluğu doğrulanır; miktar 1–min(stok,10) aralığındadır. Görsel, gerçek varyant/eksik kod açıklaması, miktar, birim ve satır fiyatı, ara toplam, silme, checkout bağlantısı vardır. Başarısız kayıt başarı gibi gösterilmez. Header sayısı, aynı sayfa ve başka sekme değişiklikleri senkronize edilir. Sepet değişiklikleri mevcut hukuki önizleme/onayları geçersizleştirir. Sunucu fiyat/stok/checkout kuralları değiştirilmedi.

Native dialog, aria etiketleri, Tab/ShiftTab trap, Escape, tetikleyiciye odak dönüşü, hata/yeniden deneme ve skeleton durumları eklendi. Checkout içinden düzenleme formu yeniden yüklemez. Mobil checkout başlık örtüşmesi scoped CSS ile düzeltildi.

Statik çok sayfalı storefront korunur: 160ms hafif CSS giriş geçişi, loading/skeleton ve reduced-motion vardır. Yeni router, yapay gecikme, ağır animasyon bağımlılığı veya kişisel form verisini saklayan yeni persistence yoktur. Yerel tarayıcı geri/ileri ve BFCache form dönüşü test edildi.

Ana H1 hero dosyaları `public/index.html`, `public/hybrid-storefront.css` değişmedi. Backend, migration, ödeme adaptörleri, bağımlılıklar ve workflow'lar değiştirilmedi.

## Gerçek doğrulama sonuçları

| Kapı | Sonuç | Kanıt |
|---|---|---|
| TypeScript | PASS | `hybrid-h1-1/evidence/typecheck-accepted.log` |
| ESLint | PASS: 0 hata, önceden mevcut 5 uyarı | `hybrid-h1-1/evidence/lint-accepted.log` |
| Normal production build | PASS, Next 16.3.6; alternatif bundler/font yok | `hybrid-h1-1/evidence/build-accepted.log` |
| Regresyon | 1568 PASS, 0 FAIL, 77 SKIP | `hybrid-h1-1/evidence/regression-accepted.log` |
| Yeni PostgreSQL 18.6 | 80/80 yürütme PASS, 0 SKIP; 77 atlanan durum ayrıca kapsandı (3 tekrar, benzersiz toplam diye toplanmaz) | postgres/legal/commerce/ai logları |
| ACL | 63/63 PASS | `hybrid-h1-1/evidence/acl.log` |
| Gerçek HTTP checkout | PASS, yalnız yeni disposable yerel DB | `hybrid-h1-1/evidence/http-checkout-final.log` |
| Yerel tarayıcı | 15 tam senaryo + 3 negatif senaryo seti PASS; 48 axe taraması, 0 ihlal | `hybrid-h1-1/evidence/browser-accepted.json` |
| Gerçek hosted Preview | 15 drawer/seçici + 15 checkout erişilebilirlik senaryosu PASS; 45 axe taraması, 0 ihlal | hosted JSON/logları |
| Yeni hosted betiği | node syntax + ESLint PASS | `scripts/test-cart-ux-preview-h11.mjs` |
| Secret taraması | Kaynak geçmişi 0 bulgu; teslim kanıtları commit öncesinde yeniden taranır | Git dışı redact edilmiş tarama logları |

Build yalnız Sentry upload ve Next telemetry kapalı çalıştı; yerel fontla alternatif build kullanılmadı. PostgreSQL fixture'ları yeni ve yalnız sentetiktir. Gerçek HTTP checkout: sipariş 201, stok rezervasyonu, immutable hukuk kanıtı, tekrar/idempotency, çakışma, eksik/expired token ve eski fiyat/stok/hukuk reddi doğrulandı.

Tarayıcılar: **Chrome 155.0.8059.85, Firefox 157.0, WebKit 27.2**. Genişlikler: **1440 / 1024 / 768 / 390 / 320 px**. WebKit sonucu gerçek Safari sonucu değildir.

Yerel negatif kapsam: yanlış varyant, eksik SKU, eski fiyat, azalan stok/overstock, storage reddi, yavaş/başarısız API, yeniden deneme, cross-tab hukuki onay iptali. Klavye, görünür odak, Escape, reduced-motion, taşma, sepet miktarı/toplamı ve sayfa geçişinde koruma test edildi.

Preview testleri gerçek GET katalog verisini kullandı; tüm POST/PUT/DELETE dahil GET/HEAD dışı istekler engellendi. Kişisel veri girilmedi, gerçek sipariş/ödeme/servis kaydı oluşturulmadı. Hosted sipariş yazma testi YAPILMADI; onun yerine disposable yerel HTTP kanıtı sunulur.

İlk denemelerin hataları gizlenmedi: yerel fixture pg_hba trust ayarı negatif auth testini yanıltıyordu; yalnız yeni fixture SCRAM olarak düzeltildi. İlk WebKit focus dönüşü hatası uygulamada düzeltildi. Hosted ilk testin katalog yüklenmeden yaptığı assertion test beklemesiyle düzeltildi. İlk deneme kayıtları korunur; PASS yalnız son tamamlanan çalışmalara aittir.

## Ödeme ve belirsizlikler

Checkout yalnız `discovery` sunar, kart alanı veya ödeme başarısı yoktur. PayTR server adaptörü açıkça etkinleştirme ve yapılandırma ister; varsayılan kapalı yolu, mock ve disposable DB testleri doğrulandı. iyzico yalnız domain enum'unda bulunur; çalışan entegrasyon olarak sunulmaz. Özel merchant runtime ayarları ve gerçek tahsilat **UNKNOWN**; secret okunmadı, ücretli çağrı yapılmadı. Discovery kayıt akışı yalnız disposable HTTP'de doğrulandı.

Saha CWV ve karşılaştırmalı LCP/INP/CLS **UNKNOWN**; ölçülmeyen performans kazanımı iddia edilmez. Gerçek Safari bu sprintin üç motorlu kabulüne dahil değildir. Kullanıcı H1.1 görsel kabulü beklenir.

## Görseller ve değişiklik envanteri

[Karşılaştırma galerisi](hybrid-h1-1/comparison.html), [masaüstü](hybrid-h1-1/screenshots/comparison-desktop.png), [mobil](hybrid-h1-1/screenshots/comparison-mobile.png). `hybrid-h1-1/screenshots/` altında 65 PNG; yerel ve hosted kayıtlar adlarıyla ayrıdır. Checkout yerel formu yalnız sentetik test metni, hosted form boş; gerçek müşteri verisi yoktur. Kanıt dosyalarının SHA-256 envanteri: `hybrid-h1-1/SHA256SUMS`.

Uygulama: `public/store.css`, `public/store-core.js`, `public/store-ux.js`, `public/store.js`, `public/checkout.html`.
Testler: `tests/cart-drawer-domain.test.ts`, `tests/hybrid-selector-contrast.test.ts`, `tests/storefront-ux-boundaries.test.ts`, `scripts/test-cart-ux-h11.mjs`, `scripts/test-cart-ux-preview-h11.mjs`.
Kanıtlar: bu rapor ve `docs/hybrid-h1-1/`.

Mantıksal commit'ler:

1. `eda934cda616f9dd8d8d88e38024419681f4efb1` — seçici kontrastı.
2. `19d7af037d8646779abe4fe16bda69b0157e1ae8` — drawer ve hukuki iptal.
3. `5fe3529ea67f7af9f1177e3eaa3ca940cb4d88ae` — statik loading/geçiş.
4. `a6b9cbc524ffadccc8a2a33e9630d5995a1aae92` — odak, checkout düzenleme, hata toparlama ve tarayıcı kabulü.

Yalnız feature dalına normal push. H1/release/main kaynakları, Production, secret'lar ve canlı ödeme yapılandırması korunur. Merge, Production deploy ve migration uygulanmadı. Geri alma: feature adayını kullanımdan kaldırmak; korunan H1 ve release commit'leri değişmediği için Production işlemi gerekmez.
