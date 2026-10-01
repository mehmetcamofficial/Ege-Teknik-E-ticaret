# EGE TEKNİK — RESMÎ LEGAL KAYNAKLAR

> **INTERNAL · Eylül 2026 · LEGAL REVIEW REQUIRED**
>
> Bu dosya müşteri-facing legal metin değildir. Amaç, release candidate metinlerde kullanılan başlıca resmî kaynakları ve hangi noktalarda ayrıca hukukçu/işletme doğrulaması gerektiğini kaydetmektir. Random sözleşme şablonları kaynak olarak kullanılmaz.

## 0. P3-LEGAL-1 (1 Ekim 2026) doğrulama kaydı

Bu turda yalnızca birincil resmî kaynaklar kullanıldı; hukukçu blogu veya SEO içeriği kaynak olarak alınmadı.

**Bu turda doğrudan alıntılanarak doğrulanan kaynaklar:**

| Kaynak | URL | Alınan doğrulama |
|---|---|---|
| **6698 sayılı KVKK — resmî metin (mevzuat.gov.tr PDF)** | https://www.mevzuat.gov.tr/MevzuatMetin/1.5.6698.pdf | **MADDE 5-(1):** "Kişisel veriler ilgili kişinin **açık rızası** olmaksızın işlenemez." **MADDE 5-(2):** açık rıza aranmaksızın işlenebilme şartları **a)** kanunlarda açıkça öngörülmesi · **b)** fiili imkânsızlık nedeniyle rıza açıklayamama / hayat veya beden bütünlüğünün korunması · **c)** bir sözleşmenin kurulması veya ifasıyla doğrudan doğruya ilgili olması kaydıyla sözleşmenin taraflarına ait verilerin işlenmesinin gerekli olması · **ç)** veri sorumlusunun hukuki yükümlülüğünü yerine getirebilmesi için zorunlu olması · **d)** ilgili kişinin kendisi tarafından alenileştirilmiş olması · **e)** bir hakkın tesisi, kullanılması veya korunması için zorunlu olması · **f)** temel hak ve özgürlüklere zarar vermemek kaydıyla meşru menfaat için zorunlu olması. **MADDE 6-(1)** özel nitelikli kişisel veri listesi; **MADDE 6-(2) Mülga** (2/3/2024-7499/33 md.). |
| **Resmî Gazete 24 Mayıs 2025, No. 32909** | https://www.resmigazete.gov.tr/eskiler/2025/05/20250524-1.pdf | Mesafeli Sözleşmeler Yönetmeliği değişikliği: kurulmuş/montajı yapılmış mallara ilişkin cayma hakkı istisnası **kaldırılmış**, yürürlük **01.01.2026**. ⚠️ Bu gazete nüshası taranmış (scanned) PDF olarak yayımlanmış olduğundan değişiklik metni bu oturumda makine-çekimiyle alınamadı; aşağıdaki Bakanlık rehberi ile çapraz doğrulandı. Hukukçu, madde numaraları (Madde 4 ve Madde 5) ve yürürlük hükmü ile birlikte teyit etmelidir. |
| T.C. Ticaret Bakanlığı, Tüketicinin Korunması ve Piyasa Gözetimi GD — "Mesafeli Sözleşmeler Hakkında Bilgilendirme" (17.08.2026) | https://tuketici.ticaret.gov.tr/yayinlar/tuketici-bilgi-rehberi/mesafeli-sozlesmeler-hakkinda-bilgilendirme | Cayma süresi **14 gün**; tüketici cayma bildiriminden itibaren **14 gün** içinde malı geri göndermek zorundadır; satıcı teslimat masrafları dâhil ödemelerin **tamamını 14 gün içinde** iade etmelidir; iade için kargo şirketi belirtilmemişse tüketici iade masraflarından sorumlu tutulamaz; geri ödeme tek seferde ve tüketicinin kullandığı ödeme aracına uygun yapılır. **Güncel istisna listesinde kurulumu/montajı yapılmış mallar için bağımsız bir istisna YER ALMAMAKTADIR**; listede yalnızca "**cayma hakkı süresi sona ermeden önce, tüketicinin onayı ile ifasına başlanan hizmetler**" bulunmaktadır. Bu, 01.01.2026 itibarıyla yürürlüğe giren değişikliği doğrulamaktadır. |
| KVKK Kurumu — "Aydınlatma Yükümlülüğü" | https://www.kvkk.gov.tr/Icerik/2033/Aydinlatma-Yukumlulugu- | KVKK m.10 uyarınca aydınlatmada veri sorumlusunun kimliği, verilerin **hangi amaçla** işleneceği, **kimlere ve hangi amaçla** aktarılabileceği, **veri toplama yöntemi ve hukuki sebebi** ile m.11'deki diğer hakların ilgili kişiye sağlanması gerekir. Aydınlatma ile açık rıza ayrıdır; rıza aranmaksızın da aydınlatma yükümlülüğü devam eder. |

**P3-LEGAL-1.1 ile kapanan nokta:** KVKK m.5'in bent yapısı resmî metinden doğrulandığı için `kvkk.md` §3'teki atıflar gerçek yapıya göre düzeltilmiş (bkz. aşağıdaki harita) ve **G9 kapatılmıştır**. Eşleme, faaliyetin gerçek amacı üzerinden birebir incelenerek yapılmıştır; örnek atıflar mekanik olarak dağıtılmamıştır. **m.5/2(d)** (alenileştirme) hiçbir faaliyette kullanılmamıştır.

**Hâlâ hukukçu doğrulaması gereken noktalar:**

- Resmî Gazete 24.05.2025 No.32909 değişiklik metninin **madde numaraları ve yürürlük hükmü** (yukarıdaki tarama nedeniyle makine-çekilemedi).
- Mesafeli Sözleşmeler Yönetmeliği'nin yürürlükteki **madde/dayanak numaraları**; yukarıdaki içerik Bakanlık bilgilendirme metninden alınmıştır.
- `kvkk.md` §3 eşlemesinin hukukçu tarafından genel olarak onaylanması (atıf yapısı doğrulanmıştır; faaliyet→şart seçimi hukuki değerlendirmedir).

## 1. Mesafeli satış / tüketici

### S1 — Ticaret Bakanlığı, “Mesafeli Sözleşmeler Hakkında Bilgilendirme”

- Kurum: T.C. Ticaret Bakanlığı, Tüketicinin Korunması ve Piyasa Gözetimi Genel Müdürlüğü
- Güncelleme: **17 Ağustos 2026**
- URL: https://tuketici.ticaret.gov.tr/yayinlar/tuketici-bilgi-rehberi/mesafeli-sozlesmeler-hakkinda-bilgilendirme

RC'lerde kullanılan güncel noktalar:

- Genel cayma hakkı 14 gün.
- Mal teslim edilmeden önce de cayma bildirimi yapılabilir.
- Cayma bildirimi yazılı veya kalıcı veri saklayıcısıyla yapılabilir.
- Tüketici cayma bildirimini yönelttikten sonra malı **14 gün içinde** geri göndermek zorundadır.
- Satıcı/sağlayıcı cayma halinde mevzuattaki koşullara göre ödemeleri 14 gün içinde iade eder.
- Ön bilgilendirmede iade taşıyıcısı belirtilmemişse tüketici herhangi bir taşıyıcıyla iade ettiğinde iade masrafından sorumlu tutulamaz.
- Sipariş için taahhüt edilen süre yoksa mal satışında genel azami süre 30 gündür; Ege Teknik bundan daha kısa **1–7 gün** taahhüdü vermektedir.
- Siparişten önce gösterilmeyen ek masraflar tüketiciden talep edilemez.
- Kurulum gibi ana bedel dışındaki ilave ödemeler için tüketicinin açık onayı gerekir.

**Önemli düzeltme:** Eski taslak notlarında geçen “cayma bildirimi sonrası malı 10 gün içinde geri gönderme” bilgisi güncel 17.08.2026 Bakanlık rehberiyle uyumlu değildir ve kullanılmamalıdır. RC setinde **14 gün** esas alınmıştır.

### S2 — Mesafeli Sözleşmeler Yönetmeliği / 6502 çerçevesi

- Yönetmelik ve Kanun için Ticaret Bakanlığı/Resmî Gazete/mevzuat.gov.tr güncel metinleri esas alınır.
- 6502 sayılı Kanun ve Mesafeli Sözleşmeler Yönetmeliği; ön bilgilendirme, cayma, teslim, ek ödeme, risk, uyuşmazlık ve diğer emredici tüketici haklarının temel kaynağıdır.

RC'lerde yıllık değişebilen Tüketici Hakem Heyeti parasal sınırı gibi değerler hard-code edilmemiştir; yürürlükteki yetki/sınır uygulanır.

## 2. KVKK / aydınlatma / açık rıza

### S3 — KVKK Aydınlatma Yükümlülüğü

- Kurum: Kişisel Verileri Koruma Kurumu
- URL: https://www.kvkk.gov.tr/Icerik/2033/Aydinlatma-Yukumlulugu-

Aydınlatmada veri sorumlusu kimliği, amaçlar, aktarım/alıcı grupları, toplama yöntemi-hukuki sebep ve ilgili kişi haklarının açıklanması temel alınır.

### S4 — KVKK Kurulu 18.02.2026 tarihli 2026/347 İlke Kararı

- URL: https://www.kvkk.gov.tr/Icerik/8710/veri-sorumlulari-tarafindan-acik-riza-ve-aydinlatma-metinlerinin-ayri-ayri-duzenlenmesi-gerektigi-hakkinda-kisisel-verileri-koruma-kurulunun-18-02-2026-tarihli-ve-2026-347-sayili-ilke-kararina-iliskin-kamuoyu-duyurusu

RC tasarımına etkisi:

- Aydınlatma ile açık rıza birbirinden ayrıdır.
- Aydınlatma metni için “onay/rıza” talep edilmez.
- Metinler veri sorumlusunun gerçek faaliyetine uyarlanmalıdır.
- Açık, anlaşılır ve sade dil kullanılmalıdır.
- Gerçekte olmayan veri işleme/aktarımı varmış gibi gösterilmemelidir.
- Gereksiz uzun ve karmaşık metinlerden kaçınılmalıdır.

Bu nedenle KVKK checkout'ta bilgi notice olarak sunulur; marketing/analytics gibi rıza gerektiren ayrı faaliyetler ayrı mekanizmaya sahiptir.

## 3. Çerezler / analytics

### S5 — KVKK “Çerez Uygulamaları Hakkında Rehber”

- URL: https://www.kvkk.gov.tr/Icerik/7353/Cerez-Uygulamalari-Hakkinda-Rehber

RC yaklaşımı:

- Zorunlu/işlevsel teknolojiler ile zorunlu olmayan analytics/marketing teknolojileri ayrılır.
- Zorunlu olmayan analytics için kullanıcı tercihi aktif bir hareketle alınır; varsayılan açık model kullanılmaz.
- Ege Teknik visitor analytics'i için `ANALYTICS_ENABLED` global kill-switch ve ayrıca ziyaretçi consent gate uygulanmaktadır.

## 4. KVKK yurt dışı aktarım

### S6 — KVKK “Yurt Dışına Aktarım”

- URL: https://www.kvkk.gov.tr/Icerik/2053/Yurtdisina-Aktarim

### S7 — KVKK Standart Sözleşme Bildirim Modülü duyurusu

- URL: https://www.kvkk.gov.tr/Icerik/8043/Standart-Sozlesme-Bildirim-Modulu-Hakkinda-Kamuoyu-Duyurusu

Aktif vendor için yalnız privacy/KVKK metninde “yurt dışı aktarım olabilir” demek yeterli kabul edilmez. Gerçek rol, bölge, DPA, alt işleyenler ve KVKK m.9 mekanizması ayrıca değerlendirilir. Standart sözleşme ilgili mekanizma ise imzalı sözleşmenin Kuruma bildirim süresi **5 iş günü** olarak takip edilir.

## 5. Ticari elektronik ileti / İYS

### S8 — Ticaret Bakanlığı, Ticari Elektronik İletiler / İYS

- https://ticaret.gov.tr/ic-ticaret/ticari-elektronik-iletiler
- https://ticaret.gov.tr/ic-ticaret/ticari-elektronik-iletiler/ileti-yonetim-sistemi-iys

RC/operasyon yaklaşımı:

- Marketing onayı siparişin koşulu değildir.
- Kanal/purpose consent ve ret mekanizması ayrı yürütülür.
- İYS hazır olmadan promosyon otomasyonu Production'da açılmaz.

## 6. ETBİS

### S9 — ETBİS / e-Ticaret Bilgi Platformu

- https://etbis.ticaret.gov.tr/
- https://ticaret.gov.tr/ic-ticaret/bilgi-sistemleri/elektronik-ticaret-bilgi-sistemi-etbis-ve-e-ticaret-bilgi-platformu

Kendi e-ticaret ortamı üzerinden faaliyet gösteren hizmet sağlayıcılar açısından gerçek şirket/domain kayıt durumu operasyonel olarak doğrulanmalıdır. `egeteknik.tr` için kayıt **henüz tamamlandı kabul edilmemiştir**.

Eski ETBİS QR kod uygulaması 2025'te sonlandırıldığından go-live checklistinde QR kod şartı tutulmaz.

## 7. VERBİS

### S10 — Veri Sorumluları Sicili / güncel istisna kriterleri

VERBİS kayıt yükümlülüğü şirket tipi üzerinden tahmin edilmez. 2025 mali bilanço toplamı, yıllık çalışan sayısı ve veri işleme faaliyeti gibi güncel Kurul kriterleri mali müşavir/hukukçu ile doğrulanır.

Ege Teknik için bu değerlendirme Pazartesi alınacak gerçek şirket verileri sonrasında kapatılacaktır.

## 8. GREE/TLC montaj ve garanti

### S11 — GREE Montaj Standartları

- https://www.gree.com.tr/sayfa/montaj-standartlari

RC'lerde duvar tipi split klima için güncel resmî montaj standardına bağlı temel kapsam ve standart dışı işler referans alınmıştır. Sabit TL/km veya dönemsel kampanya/ulaşım bedeli legal çekirdek metne hard-code edilmemiştir.

### S12 — GREE Garanti Şartları / ürün-kampanya sayfaları

- https://www.gree.com.tr/sayfa/garanti-sartlari

Garanti süresi/kampanya tek bir evrensel değer olarak genellenmez. Ürün/model/satın alma tarihi ve geçerli kampanya/garanti belgesi esas alınır.

## 9. Kaynak kullanma kuralı

- Mevzuat veya resmî rehber değişirse yeni legal version değerlendirilir.
- Public legal metinlere araştırma notu, `[DOĞRULAMA BEKLİYOR]`, `TBD` veya hukukçu iç notu taşınmaz.
- Resmî kaynak ile işletmenin fiili operasyonu çelişirse operasyon düzeltilmeden metin “uyumlu” ilan edilmez.
- Hukukçu review, bu source register'ın yerini almaz; özellikle KVKK aktarım, VERBİS, ETBİS, ürün bazlı cayma istisnası ve garanti uygulaması için gerçek operasyon/kontrat/belgeler ayrıca incelenir.
