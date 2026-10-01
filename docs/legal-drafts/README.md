# EGE TEKNİK — LEGAL RELEASE CANDIDATES

> **LEGAL REVIEW REQUIRED · NOT YET PUBLISHED**
>
> Bu klasördeki müşteri-facing metinler Production yayını öncesi hazırlanmış release candidate veya kontrollü taslaklardır. Avukat/hukuk danışmanı incelemesi tamamlanmadan ve açık operasyonel blokajlar çözülmeden Production legal version olarak yayınlanmazlar.

## Belge durumu

| Dosya | Durum | Amaç |
|---|---|---|
| `pre-information.md` | RC | Ön Bilgilendirme Formu / checkout kabulü |
| `distance-sales.md` | RC | Mesafeli Satış Sözleşmesi / checkout kabulü |
| `kvkk.md` | RC | KVKK Aydınlatma Metni; açık rıza değildir |
| `privacy.md` | RC | Gizlilik Politikası |
| `cookies.md` | RC | Çerez ve tarayıcı depolama bilgilendirmesi |
| `delivery-returns.md` | RC | Teslimat, montaj, cayma ve iade koşulları |
| `terms.md` | RC | İnternet sitesi kullanım koşulları |
| `installation.md` | RC | Kurulum ve montaj bilgilendirmesi |
| `marketing-consent.md` | DRAFT / FEATURE OFF | Ayrı, isteğe bağlı ticari elektronik ileti izni |
| `warranty.md` | DRAFT MODEL | Ürün/model bazlı garanti bilgisi modeli |
| `COMPLIANCE_CHECKLIST.md` | INTERNAL | ETBİS, İYS, VERBİS, KVKK aktarım ve go-live kontrolü |
| `VERIFICATION_REQUIRED.md` | INTERNAL | Kalan doğrulama maddeleri |
| `LEGAL_REVIEW_PACKET.md` | INTERNAL | Hukukçu/mali müşavir inceleme paketi |
| `IMPLEMENTATION_DEPENDENCIES.md` | INTERNAL | Teknik/operasyonel yayın bağımlılıkları |
| `SOURCES.md` | INTERNAL | Resmî kaynak kaydı |

## Yayın kuralları

1. `{{...}}` alanları sipariş anında sunucu tarafından doldurulan dinamik sipariş alanlarıdır; hata/placeholder değildir.
2. Doğrulanmamış KEP, kargo şirketi
3. VKN ve MERSİS P3-LEGAL-1.2 ile resmî şirket kaydından doğrulanmış ve Release Candidate belgelerine işlenmiştir. Luca PK/GB posta kutusu tanımlayıcıları ile şirket temsilcisinin kişisel bilgileri müşteri-facing belgelerde yayımlanmaz; KEP adresi doğrulanana kadar eklenmez.
4. Checkout'ta `pre-information` ve `distance-sales` kabulü sürüm kimliğiyle kaydedilir. KVKK aydınlatması bilgi verme metnidir; açık rıza checkbox'ına dönüştürülmez.
5. Yayımlanan legal version geriye dönük sessizce değiştirilmez; değişiklik gerekiyorsa yeni version oluşturulur.
6. Sipariş anındaki ürün/fiyat/vergi/teslimat bilgileri order snapshot ile korunur; genel legal metin her sipariş için yeniden versiyonlanmaz.
7. Pazarlama izni satış sözleşmesi, ön bilgilendirme ve KVKK aydınlatmasından ayrıdır ve siparişin koşulu değildir.

## Sabitlenmiş iş kararları

- Satıcı/veri sorumlusu: **Ege Teknik İklimlendirme Isıtma Soğutma Turizm Ticaret Limited Şirketi**.
- Teslimat taahhüdü: siparişin onaylanmasından itibaren **1–7 gün**; “iş günü” değildir.
- Klima/kurulum metinleri, ürün için geçerli GREE/TLC montaj standardı ve sipariş ekranındaki gerçek kapsama bağlıdır.
- Standart kapsam dışı iş/bedel müşteriye önceden açıklanır; ayrıca onay olmadan ek ücret uygulanmaz.
- “Spot Ürün” etiketi tek başına tüketicinin emredici haklarını ortadan kaldırmaz.
- Genel cayma süresi 14 gündür; uygulanabilir kanuni istisnalar ürün/hizmet özelinde değerlendirilir.
- Cayma bildirimi sonrası tüketicinin malı geri gönderme süresi güncel resmî Ticaret Bakanlığı rehberinde **14 gün** olarak açıklanmaktadır.
- Ödeme sağlayıcısı, taşıyıcı veya e-belge sağlayıcısı aktif/teyitli olmadan isim olarak sabitlenmez.

## Hâlâ açık olan işletme/uyum maddeleri

Pazartesi/mali müşavir teyidi bekleyenler: KEP, e-Arşiv durumu

Operasyonel olarak ayrıca ETBİS kaydı, kargo/iade taşıyıcısı, aktif ödeme kuruluşu ve aktif vendor yurt dışı aktarım mekanizmaları kesinleştirilmelidir. Ayrıntılar `COMPLIANCE_CHECKLIST.md` ve `VERIFICATION_REQUIRED.md` içindedir.

## Production yayın yolu

RC → hukukçu/işletme doğrulaması → açık blokajların kapatılması → admin legal publish → `/api/legal/required` doğrulaması → checkout acceptance testi → order legal acceptance/version kayıt testi → Production smoke test.

Repository'deki markdown dosyalarının varlığı Production'da legal belgelerin yayımlandığı anlamına gelmez.