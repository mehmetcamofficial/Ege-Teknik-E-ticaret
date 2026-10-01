# EGE TEKNİK — DOĞRULAMA GEREKTİREN ALANLAR

> **INTERNAL · LEGAL REVIEW REQUIRED · NOT CUSTOMER-FACING**
>
> Bu kayıt yalnızca halen çözülmemiş işletme, muhasebe, teknik ve hukuki doğrulamaları izler. Daha önce doğrulanmış bilgiler yeniden “bekliyor” olarak gösterilmez; eski şahıs işletmesi/7 iş günü/10 gün gibi varsayımlar geçersizdir.

Sorumlu kısaltmaları: **İŞ** işletme · **MM** mali müşavir · **AV** hukukçu/KVKK danışmanı · **TEK** teknik · **RESMÎ** resmî kayıt/sağlayıcı belgesi.

## A. Doğrulanmış ve artık açık olmayan bilgiler

- Satıcı/veri sorumlusu: **Ege Teknik İklimlendirme Isıtma Soğutma Turizm Ticaret Limited Şirketi**.
- Ticari ad: Ege Teknik.
- Vergi dairesi: Kuşadası.
- İşletme adresi ve `info@egeteknik.tr` / 0542 795 75 60 iletişim bilgileri legal RC'lere işlendi.
- Teslimat taahhüdü: sipariş onayından itibaren **1–7 gün**; “iş günü” değildir.
- Genel cayma süresi: 14 gün.
- Güncel Ticaret Bakanlığı 17.08.2026 rehberine göre cayma bildirimi sonrasında malın geri gönderim süresi: **14 gün**.
- GREE/TLC montaj standardının temel kapsamı ve standart dışı iş ayrımı güncel resmî GREE montaj standardına göre RC'lere işlendi.
- Public storefront için first-party analytics artık global kill-switch + ziyaretçi tercihi olmak üzere iki kapılı consent modeline sahiptir.
- Google Fonts ve Tailwind Play CDN runtime bağımlılıkları storefront deploy yolundan kaldırıldı; Tailwind build-time çalışır.
- Ana sayfadaki Google-hosted temsili görseller first-party local asset'lere taşındı.

## B. Şirket / sicil / muhasebe — Pazartesi teyidi

| # | Alan | Durum | Kim / kanıt |
|---|---|---|---|
| B1 | MERSİS numarası | PENDING | MM/şirket kayıtları |
| B2 | KEP adresi | PENDING | MM/şirket kayıtları; yoksa “yok” olarak teyit |
| B3 | Ticaret sicil no / oda bilgisi gerekiyorsa | PENDING | MM/RESMÎ |
| B4 | e-Fatura / e-Arşiv statüsü | PENDING | MM |
| B5 | e-belge özel entegratörü / muhasebe yazılımı | PENDING | MM |
| B6 | 2025 yıllık mali bilanço toplamı 100 milyon TL altında mı? | PENDING | MM |
| B7 | Yıllık çalışan sayısı 50'den az mı? | PENDING | MM/İŞ |
| B8 | VERBİS kayıt/istisna sonucu | PENDING LEGAL/ACCOUNTANT | B6+B7 ve güncel Kurul kriterleriyle kesinleştir |

**Public repo kuralı:** VKN gibi şirket kimlik numaralarının açık değeri bu repository'ye yazılmaz. Production legal version için gerekliyse doğrulanmış resmî kaynaktan kontrollü olarak eklenir.

## C. ETBİS

| # | Alan | Durum | Eylem |
|---|---|---|---|
| C1 | `egeteknik.tr` ETBİS kaydı | BLOCKER | e-Devlet/ETBİS üzerinden şirket/domain kaydı oluştur veya doğrula |
| C2 | ETBİS kimlik/domain eşleşmesi | PENDING | Şirket unvanı, MERSİS/VKN ve alan adını karşılaştır |
| C3 | ETBİS kayıt kanıtı | PENDING | İç kayıt olarak ekran görüntüsü/PDF/tarih sakla |

Eski ETBİS karekod şartı kullanılmaz; güncel checklist `COMPLIANCE_CHECKLIST.md` içindedir.

## D. Ödeme ve fatura

| # | Alan | Durum | Eylem |
|---|---|---|---|
| D1 | Production'da aktif ödeme yöntemi | NOT ACTIVE / PENDING | PayTR/iyzico vb. sağlayıcı onaylanmadan legal metne isim sabitleme |
| D2 | Ödeme kuruluşu sözleşmesi / veri akışı | PENDING | Sağlayıcı gerçekten aktif olduğunda AV+TEK incelemesi |
| D3 | Havale hesabı/IBAN | PENDING IF USED | Yalnız aktif yöntem olacaksa banka belgesiyle doğrula |
| D4 | Kart verisi mimarisi | DONE DESIGN RULE | PAN/CVV/expiry Ege Teknik DB/loglarında tutulmaz |

## E. Teslimat / kargo / iade

| # | Alan | Durum | Eylem |
|---|---|---|---|
| E1 | Production taşıyıcısı | PENDING | Gerçek kargo firması kesinleşince yeni legal version |
| E2 | İade taşıyıcısı | PENDING | Ön bilgilendirmeye kesin taşıyıcı koşulu eklenmeden masraf varsayımı yapma |
| E3 | Kargo tarifesi | PENDING | Checkout'ta kesin bedel gösterilmeden shipping açma |
| E4 | Şikâyet/iadeye operasyonel yanıt akışı | PENDING OWNER | Kim cevaplıyor, kanal ve SLA'yı iç operasyon olarak belirle |

Kargo henüz aktif değilken legal metinlerde belirli taşıyıcı adı uydurulmaz.

## F. Montaj / garanti

| # | Alan | Durum | Eylem |
|---|---|---|---|
| F1 | GREE/TLC standart montaj kapsamı | VERIFIED SOURCE / RC | Güncel resmî GREE standardı esas alındı; sabit fiyat/km uydurulmadı |
| F2 | Standart dışı işlerin gerçek fiyat tarifesi | PENDING OWNER | Fiyatlar varsa müşteri onayından önce gösterilecek operasyon oluştur |
| F3 | Ege Teknik'in GREE/TLC bayi/servis yetki belgesi | PENDING EVIDENCE | Yetki iddiasının kapsamını belgeyle doğrula |
| F4 | Ürün/model bazlı garanti süresi ve kampanya | PENDING PRODUCT DATA | Genel tek garanti süresi yazma; ürün kaynağıyla doğrula |
| F5 | Montaj sonrası cayma istisnasının ürün bazında uygulanması | PENDING LEGAL | Kılavuz ve somut ürün koşullarıyla değerlendir; tüm klimalara genelleme yapma |

## G. KVKK / çerez / sağlayıcılar

| # | Alan | Durum | Eylem |
|---|---|---|---|
| G1 | Saklama ve silme matrisi | PENDING LEGAL/TECH | Sipariş, fatura, legal acceptance, güvenlik, servis ve marketing için ayrı süre/işlem belirle |
| G2 | Vercel aktarım/DPA/region | PENDING LEGAL | Gerçek hesap/kontrat/subprocessor incele |
| G3 | Neon aktarım/DPA/region | PENDING LEGAL | Production bölgesi + kontrat/subprocessor incele |
| G4 | Clerk aktarım/DPA/cookie listesi | PENDING LEGAL/TECH | Gerçek Production davranışı ve DPA/subprocessor incele |
| G5 | Sentry | TEMPORARY / PENDING | Trial sürüyorsa aktarım/DPA değerlendirmesi; bitince kapat ve metni versionla |
| G6 | Analytics consent UI | IMPLEMENTED ON BRANCH | Production env + browser/network testi yapılmalı |
| G7 | Google Fonts / Tailwind Play CDN | DONE TECH | Runtime bağımlılıkları kaldırıldı; build-time/local asset modeli kullanılıyor |
| G8 | Google-hosted temsili görseller | DONE TECH | Ana sayfa first-party local asset'lere geçirildi |
| G9 | KVKK faaliyet → hukuki sebep eşlemesi | **PENDING LEGAL (P3-LEGAL-1)** | `kvkk.md` §3'teki F1-F10 eşlemesi (m.5/2, m.5/3, m.5/4, m.5/5, m.5/6) hukukçu tarafından Resmî Gazete/mevzuat.gov.tr metni üzerinden doğrulanmalıdır. Birebir madde metni bu turda makine-çekimiyle alınamamıştır; bkz. `SOURCES.md` §0 |
| G10 | Sentry varsayılan veri kategorileri | **PENDING TECH/LEGAL** | Yapılandırmada yalnız `userInfo` kapatılmış ve `httpBodies` boşaltılmıştır. Çerez, HTTP başlığı, URL sorgu parametresi ve veritabanı sorgu ayrıntısı sağlayıcı **varsayılanı** ile toplanmaktadır. Sentry gerçekten etkinleşirse bu kategoriler için ayrıca karar verilmelidir; kod değişikliği gerekiyorsa ayrı onaylı dilimde yapılacaktır |

## H. İYS / pazarlama

| # | Alan | Durum | Eylem |
|---|---|---|---|
| H1 | İYS hizmet sağlayıcı kaydı | PENDING OWNER | Gerçek şirket/marka durumunu kontrol et |
| H2 | Marketing automation | NOT ACTIVE | İYS/consent/ret akışı tamamlanmadan açma |
| H3 | Marketing consent metni | DRAFT | AV incelemesi sonrası sürümle |
| H4 | Kanal bazlı onay/ret senkronizasyonu | BLOCKER FOR MARKETING | SMS/e-posta/WhatsApp promosyonu öncesi tamamla |

## I. Yayın blokajları

Production'da gerçek ticari sipariş açılmadan önce en az şu kanıtlar tamamlanmalıdır:

1. ETBİS şirket/domain kaydı.
2. Gerekli checkout legal belgelerinin hukukçu/işletme review'u ve Production publish'i.
3. `/api/legal/required` başarılı ve checkout acceptance/version kaydı test edilmiş olmalı.
4. Aktif ödeme ve teslimat yöntemleri gerçek operasyonla birebir eşleşmeli.
5. KVKK aktif vendor yurt dışı aktarım mekanizması hukukçu tarafından değerlendirilmiş olmalı.
6. Pazarlama özelliği, İYS hazır değilse kapalı kalmalı.

## J. Artık geçersiz eski notlar

Aşağıdaki eski varsayımlar kaynak olarak kullanılmamalıdır:

- “şahıs işletmesi” → geçersiz; şirket Limited Şirket.
- “≈7 iş günü” → geçersiz; işletme taahhüdü 1–7 gün.
- “cayma sonrası 10 gün içinde geri gönderim” → güncel 17.08.2026 Bakanlık rehberine göre 14 gün.
- “standart montaj kapsamı bilinmiyor” → temel resmî GREE montaj standardı doğrulandı; yalnız işletme fiyat tarifesi/yetki/ürün bazlı koşullar hâlâ ayrıca doğrulanır.
- Eski `oncoconnect2@gmail.com` / `trendklima.com.tr` kimliği legal satıcı kimliği değildir; Production storefront'ta rastlanırsa ayrıca temizlenmelidir.