# EGE TEKNİK — Hukukçu ve İşletme Nihai İnceleme Paketi

**Hazırlanma tarihi:** 02.11.2026  
**Durum:** İNCELEMEYE HAZIR · **ONAY YOK / YAYIN YOK / CHECKOUT BLOCKED**  
**Git dalı:** `fix/legal-review-address-kvkk-20261102`

> Bu paket teknik ön inceleme ve insan onaylarının toplanması içindir. Sözleşmelerin hukuken uygun olduğu sonucu çıkarılamaz. Formlar bilinçli olarak imzasızdır. ETBİS işlemi, şirket yetkilisinin yapacağı ayrı açık iştir.

## 1. İncelenecek müşteri metinleri — sürüm kimliği

Lütfen yalnızca aşağıdaki **müşteri aday dosyalarını** inceleyin; `docs/legal-drafts/` altındaki iç inceleme işaretli kaynaklar müşteri yayını için değildir.

| Belge | Slug | Aday metin | Aday dosyanın SHA-256 özeti (tam) | İnceleme |
|---|---|---|---|---|
| Mesafeli Satış Sözleşmesi | `distance-sales` | [Aday metin](distance-sales.md) | `3944fbcbd5922ab0bdac53ed262c7353d51fc39a85d52c215cc74b29d36a48ec` | ☐ |
| Ön Bilgilendirme Formu | `pre-information` | [Aday metin](pre-information.md) | `7d1ad76825fbeded2dafdf46f327b26b7d820c7471b055a58f178e67c3671760` | ☐ |
| KVKK Aydınlatma Metni | `kvkk` | [Aday metin](kvkk.md) | `cabcda58c766d4facd8039f6e6807695aa733ad68d19a68ac5b3b5ca8c31a3de` | ☐ |

Bu SHA-256 özetleri 02.11.2026 Mac terminalinde çalışan **çevrimdışı yapısal denetimin ürettiği müşteri aday dosyalarına** aittir. `docs/h4/legal-review/inventory.json` kaynak taslakları tanımlar; kayıtlardaki hash'ler yukarıdaki müşteri metni hash'leriyle aynı değildir. Veritabanında kullanılan `hashLegalDocument({title,body})` kanonik başlık+metin özeti ise **üçüncü ve ayrı bir değerdir**. Onay, tam olarak gösterilen nihai metne verilmelidir; tek karakterlik değişiklikte hash ve onay yenilenir.

### Checkout rolü

- `distance-sales`: siparişte sürüm kimliğiyle kaydedilen zorunlu kabul.
- `pre-information`: sipariş öncesi zorunlu bilgilendirme ve teyit/sürüm kaydı.
- `kvkk`: aydınlatma/bilgilendirme; **açık rıza ya da zorunlu pazarlama onayı kutusu değildir**.

## 2. Sabit şirket kimliği ve adresi

- Unvan: **Ege Teknik İklimlendirme Isıtma Soğutma Turizm Ticaret Limited Şirketi**
- Ticari ad: **Ege Teknik**
- Vergi dairesi: **Kuşadası Vergi Dairesi**
- VKN: **3250963985**
- MERSİS: **0325096398500001**
- Ticaret sicil no: **10388**
- **Kullanılacak satıcı adresi:** Cumhuriyet Mah. Ant Sk. No: 7 B, Kuşadası / Aydın
- E-posta: info@egeteknik.tr · Telefon: 0542 795 75 60 · Site: egeteknik.tr

Adres, kullanıcı tarafından daha önce resmî şirket kaydıyla doğrulanmış hali olarak özellikle teyit edilmiştir. Eski İkiçeşmelik kaydı satıcı adresinin yerine geçirilmeyecek. Bu pakette resmî belge **yeniden açılıp doğrulanmadı**. Ayrı iade/ürün kabul adresi varsa şirket ayrıca teyit etmelidir. KEP bilgisi teyitsizse tahmin edilerek metne eklenmeyecek.

## 3. Hukukçu / KVKK danışmanına karar soruları

| Kod | Soru / inceleme konusu | İstenen karar / kanıt | Sonuç |
|---|---|---|---|
| H01 | Mesafeli satış ve ön bilgilendirme metinleri, mevcut ödeme-sonra-teyit akışı ve `Siparişi Onayla — ödeme yükümlülüğü doğurur` ifadesiyle uyumlu mu? | İlgili metin, checkout düğmesi ve gerekiyorsa düzeltme | ☐ |
| H02 | Teslimat taahhüdü **siparişin onayından sonra 1–7 gün**, iş günü değil: gerçek operasyon ve mevzuatla uyumlu mu? | Onay veya yeni uygulanabilir taahhüt | ☐ |
| H03 | Klima **malı** ile **montaj hizmeti** için cayma / istisna ayrımı doğru mu? | Ürün ve hizmet bazlı görüş | ☐ |
| H04 | 14 günlük cayma, 14 günlük geri gönderim, geri ödeme başlangıcı ve iade taşıyıcısının belirtilmemesi hallerindeki masraf düzeni doğru mu? | Metin incelemesi ve şirketin iade prosedürü | ☐ |
| H05 | Spot / ikinci el ürün açıklamaları ile ayıplı mala ve garantiye ilişkin hükümler yeterli mi? | Model / garanti / ürün durumu kanıtı | ☐ |
| H06 | KVKK m.5 hukuki sebep eşlemeleri, aydınlatmanın rızadan ayrılması, ilgili kişi başvurusu ve VERBİS istisnası değerlendirmesi uygun mu? | KVKK hukuk görüşü ve mali müşavir verileri | ☐ |
| H07 | Vercel, Neon, Clerk, Sentry ve etkin diğer sağlayıcılar için gerçek veri bölgesi, veri işleyen rolleri, DPA/alt işleyenler ve KVKK m.9 aktarım şartları karşılanıyor mu? | Sözleşme/transfer kanıtları ve karar | ☐ |
| H08 | Sipariş, fatura, kabul, müşteri hesabı, güvenlik ve analitik için ayrı saklama/silme matrisi tanımlı mı? | Onaylı saklama-silme matrisi | ☐ |

## 4. İşletme yetkilisi / mali müşavir kararları

| Kod | Gerçek operasyonu doğrulanacak alan | Beklenen kanıt / karar | Sonuç |
|---|---|---|---|
| O01 | **4 metreye kadar GREE/TLC standart montaj** ve dahil parçalar, 4 m üstü / özel iş fiyatlandırması | Güncel servis standardı, şirketin uygulaması, ek ücret ön onayı | ☐ |
| O02 | Aktif ödeme türü: online kart, havale ya da sonradan ödeme hangisi? | Sağlayıcı sözleşmesi veya teyitli aktif yöntem; ödeme ekranıyla eşleşme | ☐ |
| O03 | Satış bölgesi, teslimat, kargo, taşıyıcı ve ücretler | Operasyon tarife ve hizmet bölgesi tablosu | ☐ |
| O04 | Cayma/iade başvurularını kim, hangi e-posta/adres/telefon ve hangi süreçle yanıtlar? | İade/şikâyet prosedürü; fiili iade adresi | ☐ |
| O05 | Ürün/model bazlı garanti süresi ve şirketin bayi/servis yetkisi | Garanti belgeleri ve yetki kapsamı | ☐ |
| O06 | e-Fatura/e-Arşiv, mali müşavir, çalışan/bilanço ve VERBİS değerlendirmesi | Güncel mükellefiyet / muhasebe kanıtı | ☐ |
| O07 | ETBİS `egeteknik.tr` şirket/domain kaydı | **Şirket yetkilisi tarafından** tamamlanmış kayıt ve tarihli kanıt | ☐ |
| O08 | Sipariş sonrası müşteri ve yönetici bilgilendirmesinin gerçek çalışması | E-posta/operasyon sorumlusu ve kabul testi | ☐ |

## 5. Hukuki metnin nihai onayı

Her belge için **ayrı imza** atılacak. Onaylanacak nihai metin önce bu adayla karşılaştırılmalı; değişiklik gerekiyorsa yeni revizyon hazırlanıp SHA-256 yeniden hesaplanmalı. Boş alanlar bir varsayılan onay sayılmaz.

| Belge | Nihai dosya SHA-256 | Sonuç (ONAY / REVİZYON / RET) | İsim / rol | Tarih / imza |
|---|---|---|---|---|
| Mesafeli Satış Sözleşmesi | __________________ | __________________ | __________________ | __________________ |
| Ön Bilgilendirme Formu | __________________ | __________________ | __________________ | __________________ |
| KVKK Aydınlatma Metni | __________________ | __________________ | __________________ | __________________ |

**Şirket yetkilisi operasyon onayı:** __________________ · Tarih: __________ · İmza: __________

**Hukukçu/KVKK danışmanı görüş kaydı (belge veya referans):** __________________

**Mali müşavir teyit kaydı (ilgili kalemlerde):** __________________

**Teknik doğrulayan:** __________________ · Tarih: __________

## 6. Teknik hazırlık ve kalan yayın kapısı

02.11.2026 Mac çıktılarına göre:

- Önceki hukuki yazılım kontrolleri: **78/78 PASS** (59 birim/protokol + 19 izole PostgreSQL 18).
- Yeni aday metin dönüşümü: **3/3 PASS**.
- `node scripts/verify-legal-publication.mjs --structural-only`: **PASS — bu yayın yetkisi değildir.**
- `pnpm verify:legal-publication`: **beklendiği gibi BLOCKED**. `release-gates.json` içinde halen 3 belge onayı ve 6 farklı release blokajı açık.
- Production hukuki belgelerin yayınlandığı veya checkout'un açıldığı **iddia edilmemektedir**.

**İnsan ve işletme onayları tamamlandıktan sonra**: nihai başlık+metin kanonik özetini onayla → owner hesabıyla taslak oluştur → audit/versiyon doğrula → ayrı açık yayın onayı al → yürürlük tarihiyle yayınla → `/api/legal/required`, doğru KVKK notice, sürüm linkleri, fail-closed ve kabul ispatını kontrol et. Gerçek sipariş testi ayrıca açık izin gerektirir.

**Önemli:** `release-gates.json` içindeki `approval`, `cleared` ve `evidence` değerlerini yalnızca bağımsız doğrulanmış insan onayıyla güncelleyin. Sadece bu dosyadaki kutuların doldurulması otomatik olarak yayımlama yetkisi vermez.

## 7. Paket eki ve kaynak zinciri

- [Üç müşteri adayı ve kontrol talimatı](README.md)
- [Makine tarafından değerlendirilen yayın engelleri](release-gates.json)
- [İçerik kaynaklarının eski/sabit dosya özetleri](../h4/legal-review/critical-legal-candidate-lock-20261102.md)
- [Kapsamlı insan onay listesi](../h4/legal-review/approval-checklist.md)
- [İşletme ve hukuk doğrulaması gerektiren alanlar](../legal-drafts/VERIFICATION_REQUIRED.md)

**Karar: NO-GO** — gerçek satış ve Production hukuki yayını için hiçbir imza/onay varsayılmadı.
