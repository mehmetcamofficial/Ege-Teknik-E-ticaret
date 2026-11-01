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
