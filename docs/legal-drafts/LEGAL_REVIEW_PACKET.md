# EGE TEKNİK — LEGAL REVIEW PACKET

> **RELEASE CANDIDATE REVIEW PACKET · NOT YET PUBLISHED**
>
> Bu dosya hukukçu/mali müşavir için tek giriş noktasıdır. Müşteriye gösterilecek legal metin değildir.

## 1. İncelenecek RC belgeler

- `pre-information.md` — Ön Bilgilendirme Formu
- `distance-sales.md` — Mesafeli Satış Sözleşmesi
- `kvkk.md` — KVKK Aydınlatma Metni
- `privacy.md` — Gizlilik Politikası
- `cookies.md` — Çerez ve Tarayıcı Depolama Bilgilendirmesi
- `delivery-returns.md` — Teslimat / Montaj / Cayma / İade
- `terms.md` — İnternet Sitesi Kullanım Koşulları
- `installation.md` — Kurulum ve Montaj Bilgilendirmesi

`marketing-consent.md` henüz **DRAFT / FEATURE OFF**, `warranty.md` ise **DRAFT PRODUCT MODEL** olarak tutulur.

## 2. Doğrulanmış satıcı/veri sorumlusu

**Ege Teknik İklimlendirme Isıtma Soğutma Turizm Ticaret Limited Şirketi**

Ticari ad: Ege Teknik
Adres: Cumhuriyet Mah. Ant Sk. No: 7 B, Kuşadası / Aydın
Vergi dairesi: Kuşadası
E-posta: info@egeteknik.tr
Telefon: 0542 795 75 60
Web: egeteknik.tr

Public repository içine VKN açık değeri yazılmaz. Production legal kayıtta gerekliyse doğrulanmış resmî belgeden kontrollü eklenmelidir.

## 3. Pazartesi kapanacak şirket/muhasebe maddeleri

- MERSİS
- KEP (varsa)
- ticaret sicil/oda bilgisi gerekirse
- e-Fatura/e-Arşiv statüsü
- e-belge sağlayıcısı / muhasebe yazılımı
- 2025 yıllık mali bilanço toplamı
- yıllık çalışan sayısı
- varsa mevcut VERBİS/ETBİS/İYS kayıtları

VERBİS sonucu şirket tipiyle tahmin edilmeyecek; gerçek 2025 finansal/çalışan verisi ve güncel Kurul kriteriyle kapatılacaktır.

## 4. E-ticaret iş modeli

### Teslimat

İşletme taahhüdü: **Sipariş konusu ürünler siparişin onaylanmasından itibaren 1–7 gün içerisinde teslim edilir.** “İş günü” değildir.

Kargoya uygun ürünlerde shipping ancak gerçek taşıyıcı, tarife ve iade koşulları checkout'ta aktif/şeffaf olduğunda açılır. Taşıyıcı kesinleşmeden belirli firma adı legal metne sabitlenmez.

### Klima / montaj

Ürün/sipariş sayfasında standart montajın dahil olduğu belirtilen duvar tipi split klima için güncel GREE/TLC montaj standardı referans alınır. RC seti, 4 metreye kadar standart tesisat ve standart montaj malzemeleri gibi güncel resmî kapsamı; elektrik hattı, standart dışı ilave tesisat, özel inşai işler ve özel erişim ekipmanları gibi kapsam dışı kalemlerden ayırır.

Ek iş/bedel müşteriye önceden açıklanmadan ve ayrıca onay alınmadan ücretlendirilmemelidir.

Ege Teknik'in doğrudan hizmet veremediği durumda uygun yetkili servis yönlendirmesi yapılabilir; üçüncü taraf servisin müsaitliği/ücreti/randevusu Ege Teknik tarafından otomatik garanti edilmiş sayılmaz.

### Spot Ürün

“Spot Ürün” etiketi tek başına tüketicinin emredici haklarını kaldırmaz. Bilinen kondisyon, kullanım izi, kozmetik durum, eksik aksesuar veya kusur satın alma öncesinde açıkça gösterilmelidir.

### Ödeme

PayTR/iyzico vb. bir kuruluş sözleşmeli ve aktif olmadan legal metne kesin provider adı konulmaz. Kart PAN/CVV/expiry Ege Teknik uygulama DB/loglarına alınmaz.

## 5. Cayma / iade / ayıplı mal

RC setinde güncel resmî Bakanlık rehberine göre:

- genel cayma süresi 14 gün,
- teslimden önce de cayma bildirimi mümkündür,
- bildirimin yazılı/kalıcı veri saklayıcısıyla yapılabilmesi öngörülür,
- cayma bildirimi sonrası malın geri gönderim süresi **14 gün**,
- iade taşıyıcısı ön bilgilendirmede belirtilmemişse tüketici aleyhine otomatik iade kargo masrafı varsayımı yapılmaz,
- ayıplı mala ilişkin kanuni haklar cayma hakkından ayrı tutulur.

Klima montajı sonrası cayma istisnası bütün klima ürünlerine genellenmemiştir; ilgili ürünün kılavuzu, kurulum şartı ve yürürlükteki istisnanın somut koşulları hukukçu tarafından teyit edilmelidir.

## 6. KVKK / veri akışı

Ana teknik sağlayıcılar:

- Vercel — hosting/runtime/deployment
- Neon — PostgreSQL
- Clerk — müşteri hesabı/kimlik doğrulama
- Sentry — geçici observability trial

Her provider için gerçek hesap/region/DPA/subprocessor/rol/aktarım mekanizması incelenmelidir. Privacy/KVKK metninde sağlayıcıyı anmak aktarımı tek başına hukuka uygun hale getirmez.

Standart sözleşme uygulanacak mekanizma ise doğru controller/processor senaryosu kullanılmalı ve resmî bildirim süresi/kanıtı işletme dosyasında tutulmalıdır.

## 7. Analytics / çerez mimarisi

Visitor analytics artık iki kapılıdır:

1. Production global `ANALYTICS_ENABLED=true`,
2. ziyaretçi `ege_analytics_consent=1` tercihi.

İkisi birlikte yoksa event kaydı ve `ege_vid` oluşturma yapılmaz. Ziyaretçi analytics iznini geri çekerse HttpOnly `ege_vid` server-side silinir.

Satış/sipariş istatistikleri gerçek `orders` verisinden gelir ve visitor analytics consent'ine bağlı değildir. Visitor/page/product/referrer/device ölçümleri yalnız analytics izni veren ziyaretçiler için toplanır.

V1 hardening kapsamında Google Fonts, Tailwind Play CDN ve Google-hosted temsili görseller runtime storefront yükleme yolundan kaldırılmıştır. Ana sayfa CSS'i build-time üretilir ve temsili görseller first-party local asset olarak sunulur. Buna rağmen Production browser/network smoke ile bu davranış son kez doğrulanmalıdır; aktif Vercel/Neon/Clerk/Sentry veri akışları ise KVKK yurt dışı aktarım incelemesinde ayrı değerlendirilmeye devam eder.

## 8. ETBİS / İYS / VERBİS

**ETBİS:** `egeteknik.tr` için gerçek şirket/domain kaydı henüz kanıtlanmadı; gerçek ticari launch blokajıdır.

**İYS:** promosyon SMS/e-posta/WhatsApp otomasyonu hazır değilken kapalı kalmalıdır. Marketing izni siparişten bağımsız ve isteğe bağlıdır.

**VERBİS:** güncel istisna kriteri gerçek bilanço/çalışan sayısıyla uygulanacak; istisna varsa dahi diğer KVKK yükümlülükleri devam eder.

## 9. Teknik legal ispat modeli

Checkout için required acceptance slugs:

- `pre-information`
- `distance-sales`

KVKK bilgi notice'dır, rıza değildir.

Sipariş ispatı şu üç parçadan oluşur:

**published legal version + order snapshot + server-side acceptance timestamp/version IDs**.

Yayımlanmış legal version geriye dönük sessizce değiştirilmemelidir; yeni metin gerekiyorsa yeni version oluşturulmalıdır.

## 10. Hukukçudan istenen final görüşler

1. RC'lerdeki satıcı kimliği/ön bilgilendirme unsurları yeterli mi?
2. 1–7 günlük teslim taahhüdü ve ifa/iadeye ilişkin hükümler doğru mu?
3. Klima montajı sonrası cayma istisnası hangi ürün/kılavuz şartlarında uygulanabilir?
4. Spot Ürün açıklamaları tüketici hakları açısından yeterli mi?
5. KVKK aydınlatma amaç/hukuki sebep/alıcı grubu/yurt dışı aktarım bölümleri gerçek veri akışıyla uyumlu mu?
6. Vercel/Neon/Clerk/Sentry için hangi m.9 aktarım mekanizması uygulanmalı?
7. ETBİS/VERBİS/İYS tarafında şirkete özel hangi tamamlamalar zorunlu?
8. Marketing consent DRAFT'ı İYS aktivasyonu öncesi nasıl sonlandırılmalı?
9. Kargo/iade taşıyıcısı ve payment provider aktif olduğunda hangi maddeler yeni version gerektirir?
10. Production publish öncesinde değiştirilmesi gereken tüketici aleyhine, muğlak veya gereksiz uzun herhangi bir ifade var mı?

## 11. Publish gate

Production legal publish ancak:

- Pazartesi şirket/muhasebe bilgileri kapatıldıktan,
- ETBİS ve aktif vendor aktarım blokajları ele alındıktan,
- hukukçu final review tamamlandıktan,
- gerçek aktif ödeme/teslimat modeline göre son metinler kontrol edildikten

sonra yapılmalıdır.

Publish sonrası `/api/legal/required`, exact-version link, stale-version rejection, checkout acceptance ve `order_legal_acceptances` kayıtları Production smoke ile doğrulanmalıdır.
