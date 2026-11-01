# EGE TEKNİK — Ödeme, teslimat, iade ve bildirim operasyon incelemesi

**Tarih:** 2026-11-02  
**Karar:** **BLOCKED / NO-GO**. Sadece kaynak kod ve Vercel ortam değişkeni **ad/kapsam metadata** kontrolü yapıldı. Secret değeri okunmadı, Production/Preview veritabanına yazılmadı, deploy/merge yapılmadı.

## 1. Kaynak kodla doğrulanan teknik kapasite

| Alan | Kaynak | Teknik olarak mevcut | İşletme / Production gerçeği |
|---|---|---|---|
| Checkout ödeme tipi kabul listesi | `lib/order-domain.ts` | `PayTR`, `iyzico`, `discovery` şemada tanımlı | Bir şema seçeneği gerçek tahsilat entegrasyonu veya onayı değildir |
| PayTR | `lib/paytr.ts`, `app/api/payments/paytr/token/route.ts` | iFrame hazırlık modülü; `PAYTR_ENABLED=true` ve yapılandırma olmadan disabled | Vercel Production metadata'da PAYTR_* değişkenleri bulunmadı; daha önce şirket başvurusu reddedilmişti. Gerçek tahsilat **hazır kabul edilmez** |
| iyzico | `lib/order-domain.ts` | Talep şemasında isim var | API tahsilatının canlı ve sözleşmeli olduğu doğrulanmadı |
| Manuel / sonradan ödeme | `discovery` ödeme tipi; `docs/h4/order-operations.md` | Siparişin ödeme bekleyen statüsüyle yürütülmesi modellenmiş | Banka hesabı, ödeme talimatı, kimin/hangi sürede teyit edeceği, e-belge ve tahsilat mutabakatı henüz karara bağlanmadı |
| Klima / montajlı teslimat | `lib/delivery.ts`, `lib/checkout-charges.ts` | `dealer` yolu; standart montaj + firma teslimatı ürün fiyatına dahil, ayrıca ücret sıfır | 4 m standart kapsam, servis yetki/bölge ve ek işlerin onaylı tarifesi eksik |
| Yedek parça teslimatı | `lib/delivery.ts` | `pickup` serbest; `shipping` yalnız taşıyıcı tarife onaylanırsa | `CHECKOUT_TARIFFS.shipping.status=pending`; kargo reddediliyor, ücret veya taşıyıcı uydurulmaz |
| Sipariş bildirimi | `lib/notifications/outbox.ts`, Mac testleri | Outbox mekanizması var | Testte `notification_enqueue_failed {code:'unknown'}` görüldü; gerçek Production bildiriminin teslim edildiği gösterilmedi. `docs/h4/order-operations.md` daha eski bildirim durumunu anlatıyor, güncel operasyon testi gerekir |

## 2. Production ortam metadata incelemesi

Vercel projesi: `dragonfire-09s-projects/ege-teknik-phase3a`.

Salt-okunur `filter_project_envs(decrypt=false)` sonucunda ödeme/mesajlaşmayla ilgili `PAYMENT_PROVIDER`, `RESEND_API_KEY`, `MAIL_FROM` değişkenleri **Preview** kapsamında görünmektedir. **Production** kapsamında PAYTR_* veya IYZICO_* ödeme credential isimleri görünmedi. Bu sonuç, başka harici sistem ya da paylaşılan yapılandırma bulunmadığını kesin olarak kanıtlamaz; ancak gerçek Production ödemesini PASS ilan etmek için yeterli kanıt yoktur. Değerler okunmadı.

## 3. İşletmeden karar ve kanıt istenen alanlar

| Kimlik | Yetkili | Karar / doğrulanabilir kanıt | Durum |
|---|---|---|---|
| PAY-01 | İşletme sahibi | Go-live ödeme modeli: `manual-after-order`, sözleşmeli sanal POS ya da yalnız sipariş talebi; hangisi? | PENDING |
| PAY-02 | Mali müşavir / işletme | Havale/EFT kullanılıyorsa doğru şirket alıcı adı, müşteri bilgilendirme, tahsilat ve iptal/iade prosedürü | PENDING |
| PAY-03 | İşletme / teknik | Ödemeyi kim ve hangi kanıtla doğrular; ödeme alınmadan sipariş statüsü nasıl ilerler? | PENDING |
| DEL-01 | İşletme | 4 metre GREE/TLC montaj kapsamı, servis yetki belgesi, ilave iş onay ve ücret politikası | PENDING |
| DEL-02 | İşletme | 1–7 takvim günü gerçek teslim kabiliyeti, il/ilçe hizmet alanı, farklı süre istisnaları | PENDING |
| DEL-03 | İşletme | Parça kargosu için taşıyıcı, KDV dahil ücret, iade taşıyıcısı ve iade adresi | PENDING |
| OPS-01 | İşletme | Yeni siparişi, müşteri bildirimini ve hatalı/başarısız bildirimi kim takip eder? SLA ve manuel yedek süreç | PENDING |
| LEG-01 | Hukukçu | Nihai ödeme butonu, ön bilgilendirme ve mesafeli satış metni gerçek modelle uyumlu mu? | PENDING |

## 4. Güvenli karar sırası

1. İşletme `PAY-01` ödeme modelini yazılı olarak seçer; **varsayım yapılmaz**.
2. Seçilen modele göre checkout ve mali kayıt fark analizi yapılır; hukuki metin revizyonu gerekirse aday SHA-256 yeniden hesaplanır.
3. Teslimat/4 m montaj, iade, bildirim operasyon sorumluları ve ücretleri ayrı kanıtla doğrulanır.
4. Hukukçu ödeme yükümlülüğü, cayma ve KVKK bölümlerini nihai metin üzerinde onaylar.
5. ETBİS ve diğer işletme/owner kapıları tamamlanmadıkça `release-gates.json` değişmez; Production hukuki yayın veya sipariş kabulü açılmaz.

**Sonuç:** Kodda ödeme yolu bulunması Production tahsilatının açık olduğu anlamına gelmez. Canlı ödeme hizmeti ve gerçek operasyon şartları onaylanmadan sözleşme güncellemesi veya ödeme etkinleştirilmesi yapılmayacaktır.

## 5. İşletme ürün kararı — müşterinin çoklu ödeme seçimi (2026-11-02)

**KARAR VERİLDİ (ürün davranışı):** Müşteri checkout'ta nasıl ödeyeceğini kendisi seçecek: (1) sipariş sonrası havale/EFT veya manuel ödeme, (2) sözleşmeli banka sanal POS'u, (3) iyzico. Bu, üç sağlayıcının bugün aktif olduğunun veya ödeme kabulüne izin verildiğinin teyidi **değildir**.

- **PAY-01 ürün seçimi: KARAR VERİLDİ; operasyonel hazırlık: BLOCKED.** Havale/EFT'nin gerçek şirket hesap bilgileri, alıcı adı, ödeme vadesi, iade prosedürü ve mutabakat yetkilisi henüz işletmece doğrulanmadı.
- Banka POS'u ve iyzico **yalnız** ayrı işyeri sözleşmesi, anahtar/ortam konfigürasyonu, test ödeme+iade+callback doğrulaması ve hukukçu gözden geçirmesi geçerse müşteri için etkin/görünür olacak. Sonradan etkinleşen sağlayıcı ayrı yayın kararı gerektirir.
- Checkout bir **sunucu kontrollü ödeme yöntemleri envanteri** kullanmalı; etkin olmayan yöntemi seçtirmemeli. Seçenek değiştirildiğinde tutar, sipariş/ödeme bağlamı ve hukuki önizleme gerektiren değişiklikler yeniden sunucu tarafından hesaplanmalı; onay değişirse eski token reddedilmeli.
- İstemcinin gönderdiği `paymentProvider` tek başına ödeme tamamlandı kanıtı olamaz. Havale/EFT için işletme tahsilat mutabakatı, kart için doğrulanmış sağlayıcı webhook/ödeme kaydı gerekir. Çift tahsilat ve tekrar bildirimlere karşı idempotent işleme zorunlu.
- Mevcut `orderRequestSchema` yalnız `PayTR`, `iyzico`, `discovery` değerlerini tanıyor. **`discovery` havale/EFT ile aynı anlamda varsayılmayacak**; banka POS'u da otomatik olarak PayTR diye etiketlenmeyecek. Yeni sağlayıcı bağımsız adapter/enum ve migration uygunluğu incelenerek uygulanmalı.
- Hukuki metinlerin ödeme, iade ve ödeme yükümlülüğü ibareleri nihai ödeme UX ile hukukçu tarafından karşılaştırılmalı; bir metin değişirse ilgili aday hash'i yeniden üretilecek. `release-gates.json` hâlâ BLOCKED.

**Bu karar yalnızca ayrı Git dalındaki planlama kaydıdır. Üretim koduna, ödeme konfigürasyonuna, onay kutularına veya Production DB'ye değişiklik uygulanmadı.**

## 6. 2026-11-02 Havale/EFT önce — ayrı dalda uygulanan sınırlı checkout değişikliği

Kullanıcı açıkça **Havale/EFT sipariş seçeneğini ilk aşamada**, banka POS'u ile iyzico'yu ise başvuru/onay sonuçlarına kadar **pasif** istedi.

- `public/checkout.html` ödeme yöntemini **Havale / EFT — sipariş sonrası ödeme** adıyla gösterir. İç API değerini, mevcut checkout ile geriye dönük uyumu korumak için `discovery` olarak bırakır; bu **yeni ve bağımsız bir havale ödeme kayıt altyapısının tamamlandığı anlamına gelmez**.
- Müşteriye IBAN/banka hesabı uydurulmaz; doğrulanmış şirket hesabı ve sipariş referansı işletme tarafından ayrıca iletilir. Sipariş kayıtlı ama **ödenmemiş** durumdadır; yetkili muhasebe/tahsilat doğrulaması olmadan ödendiye alınamaz.
- Banka POS'u ile iyzico checkout'ta seçilemez; ikisi de bağlanan, sözleşmeli ve testleri geçmiş gerçek sağlayıcılar olmadan açılmaz.
- `tests/checkout-bank-transfer-policy.test.mjs` yeni ürün politikası için kaynak-kod/HTML regresyon testidir; Mac'te çalıştırılmadıkça PASS raporlanmaz.
- **Sınır:** Bu aşama yalnız müşteri metni ve mevcut `discovery` akışını kullanır; yeni `bank_transfer` enum, IBAN yönetimi, ödeme son tarihi, otomatik mutabakat, yeni admin ödeme eşleştirme, etkinleştirilmiş Production sipariş kabulü veya gerçek tahsilat içermez. Bu yetenekler bağımsız teknik ve işletme onayı ister.
- **Production yasal kapısı hâlâ BLOCKED**: ETBİS, onaylanmış hukuki metinler, montaj ve teslimat/iadeler. Bu dal `main`e merge edilmedi; deploy edilmedi.
