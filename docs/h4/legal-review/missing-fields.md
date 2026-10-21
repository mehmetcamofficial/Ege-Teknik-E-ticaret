# Eksik alanlar listesi (H4-A)

Kaynak: `docs/legal-drafts/VERIFICATION_REQUIRED.md` (hukuk/işletme ekibinin kaydı) satır satır ayrıştırıldı; bu görevde hiçbir değer doğrulanmadı veya uydurulmadı.
**Doğrulanmış** ile **eksik/bekleyen** bilgiler ayrı gösterilir. Toplam: 30 açık, 8 doğrulanmış/tamamlanmış satır.

## 1. Açık / bekleyen / kısmi maddeler (30)

| Kod | Alan | Durum | Eylem / kanıt |
|---|---|---|---|
| B2 | KEP adresi | PENDING | Hâlâ doğrulanmadı. Elektronik Bildirim Adresi KEP adresi sayılmaz; ayrıca teyit gerekir |
| B4 | e-Fatura / e-Arşiv statüsü | PARTIAL (P3-LEGAL-1.2) | e-Fatura mükellefi: EVET, geçiş tarihi 01.07.2023. e-Arşiv ve özel entegratör hâlâ PENDING |
| B5 | e-belge özel entegratörü / muhasebe yazılımı | PENDING | MM |
| B6 | 2025 yıllık mali bilanço toplamı 100 milyon TL altında mı? | PENDING | MM |
| B7 | Yıllık çalışan sayısı 50'den az mı? | PENDING | MM/İŞ |
| B8 | VERBİS kayıt/istisna sonucu | PENDING LEGAL/ACCOUNTANT | B6+B7 ve güncel Kurul kriterleriyle kesinleştir |
| C1 | `egeteknik.tr` ETBİS kaydı | BLOCKER (PENDING) | Doğrulanmadı; ETBİS üzerinden şirket/domain kaydı oluşturulmalı veya teyit edilmeli |
| C2 | ETBİS kimlik/domain eşleşmesi | PENDING | Şirket unvanı, MERSİS/VKN ve alan adını karşılaştır |
| C3 | ETBİS kayıt kanıtı | PENDING | İç kayıt olarak ekran görüntüsü/PDF/tarih sakla |
| D1 | Production'da aktif ödeme yöntemi | NOT ACTIVE / PENDING | PayTR/iyzico vb. sağlayıcı onaylanmadan legal metne isim sabitleme |
| D2 | Ödeme kuruluşu sözleşmesi / veri akışı | PENDING | Sağlayıcı gerçekten aktif olduğunda AV+TEK incelemesi |
| D3 | Havale hesabı/IBAN | PENDING IF USED | Yalnız aktif yöntem olacaksa banka belgesiyle doğrula |
| E1 | Production taşıyıcısı | PENDING | Gerçek kargo firması kesinleşince yeni legal version |
| E2 | İade taşıyıcısı | PENDING | Ön bilgilendirmeye kesin taşıyıcı koşulu eklenmeden masraf varsayımı yapma |
| E3 | Kargo tarifesi | PENDING | Checkout'ta kesin bedel gösterilmeden shipping açma |
| E4 | Şikâyet/iadeye operasyonel yanıt akışı | PENDING OWNER | Kim cevaplıyor, kanal ve SLA'yı iç operasyon olarak belirle |
| F2 | Standart dışı işlerin gerçek fiyat tarifesi | PENDING OWNER | Fiyatlar varsa müşteri onayından önce gösterilecek operasyon oluştur |
| F3 | Ege Teknik'in GREE/TLC bayi/servis yetki belgesi | PENDING EVIDENCE | Yetki iddiasının kapsamını belgeyle doğrula |
| F4 | Ürün/model bazlı garanti süresi ve kampanya | PENDING PRODUCT DATA | Genel tek garanti süresi yazma; ürün kaynağıyla doğrula |
| F5 | Montaj sonrası cayma istisnasının ürün bazında uygulanması | PENDING LEGAL | Kılavuz ve somut ürün koşullarıyla değerlendir; tüm klimalara genelleme yapma |
| G1 | Saklama ve silme matrisi | PENDING LEGAL/TECH | Sipariş, fatura, legal acceptance, güvenlik, servis ve marketing için ayrı süre/işlem belirle |
| G2 | Vercel aktarım/DPA/region | PENDING LEGAL | Gerçek hesap/kontrat/subprocessor incele |
| G3 | Neon aktarım/DPA/region | PENDING LEGAL | Production bölgesi + kontrat/subprocessor incele |
| G4 | Clerk aktarım/DPA/cookie listesi | PENDING LEGAL/TECH | Gerçek Production davranışı ve DPA/subprocessor incele |
| G5 | Sentry | TEMPORARY / PENDING | Trial sürüyorsa aktarım/DPA değerlendirmesi; bitince kapat ve metni versionla |
| G10 | Sentry varsayılan veri kategorileri | PENDING TECH/LEGAL | Yapılandırmada yalnız `userInfo` kapatılmış ve `httpBodies` boşaltılmıştır. Çerez, HTTP başlığı, URL sorgu parametresi ve veritabanı sorgu ayrıntısı s |
| H1 | İYS hizmet sağlayıcı kaydı | PENDING OWNER | Gerçek şirket/marka durumunu kontrol et |
| H2 | Marketing automation | NOT ACTIVE | İYS/consent/ret akışı tamamlanmadan açma |
| H3 | Marketing consent metni | DRAFT | AV incelemesi sonrası sürümle |
| H4 | Kanal bazlı onay/ret senkronizasyonu | BLOCKER FOR MARKETING | SMS/e-posta/WhatsApp promosyonu öncesi tamamla |

Açıkça **BLOCKER** olarak işaretli: C1, H4.

## 2. Doğrulanmış veya tamamlanmış maddeler (8)

| Kod | Alan | Durum | Eylem / kanıt |
|---|---|---|---|
| B1 | MERSİS numarası | VERIFIED (P3-LEGAL-1.2) | 0325096398500001 — şirket kayıtlarından doğrulandı |
| B3 | Ticaret sicil no | VERIFIED (P3-LEGAL-1.2) | 10388 |
| D4 | Kart verisi mimarisi | DONE DESIGN RULE | PAN/CVV/expiry Ege Teknik DB/loglarında tutulmaz |
| F1 | GREE/TLC standart montaj kapsamı | VERIFIED SOURCE / RC | Güncel resmî GREE standardı esas alındı; sabit fiyat/km uydurulmadı |
| G6 | Analytics consent UI | IMPLEMENTED ON BRANCH | Production env + browser/network testi yapılmalı |
| G7 | Google Fonts / Tailwind Play CDN | DONE TECH | Runtime bağımlılıkları kaldırıldı; build-time/local asset modeli kullanılıyor |
| G8 | Google-hosted temsili görseller | DONE TECH | Ana sayfa first-party local asset'lere geçirildi |
| G9 | KVKK faaliyet → hukuki sebep eşlemesi | DONE (P3-LEGAL-1.1) | KVKK m.5 bent yapısı resmî metinden doğrulandı (mevzuat.gov.tr, 6698 sayılı Kanun): m.5/1 açık rıza; m.5/2(a)-(f) rızasız işleme şartları. `kvkk.md` § |

## 3. Müşteriye gösterilen şirket bilgisi — kod ile kayıt karşılaştırması

| Bilgi | Kodda (public/store-core.js `business`) | Durum |
|---|---|---|
| Ticari ad | Ege Teknik | Doğrulanmış (VERIFICATION A) |
| Telefon / e-posta | 0542 795 75 60 / info@egeteknik.tr | Doğrulanmış (VERIFICATION A) |
| Adres | İkiçeşmelik Mah. Süleyman Demirel Bulvarı, Ege Uluçınar Koop. No:13/1D, 09400 Kuşadası/Aydın | Doğrulanmış (VERIFICATION A) |
| KEP adresi | gösterilmiyor | **Eksik (B2)**; "Elektronik Bildirim Adresi KEP sayılmaz" |
| ETBİS kaydı | gösterilmiyor | **Eksik (C1, BLOCKER)** |
| Kargo/iade taşıyıcısı | belirtilmiyor | **Eksik (E1–E3)**; kargo kapalı |
| Ödeme kuruluşu | belirtilmiyor | **Aktif değil (D1)** |

Yasal metinlerde doğrulanmamış bilgi yayımlanmaz kuralı korunmuştur (RC metinlerinde "KEP doğrulandığında eklenir" ifadesi bulunur).
