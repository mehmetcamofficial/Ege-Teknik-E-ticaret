> **RELEASE CANDIDATE — LEGAL REVIEW REQUIRED · NOT YET PUBLISHED**
> Bu metin, Ege Teknik sitesinde kullanılan çerez ve tarayıcı depolama teknolojilerini açıklar. Yayın öncesinde fiili üretim davranışı tarayıcı üzerinden son kez doğrulanmalıdır.

# ÇEREZ VE TARAYICI DEPOLAMA BİLGİLENDİRMESİ

## 1. Genel yaklaşım

Ege Teknik, sitenin çalışması için gerekli teknolojiler ile kullanıcının talep ettiği işlevleri sağlayan depolama mekanizmalarını veri minimizasyonu prensibiyle kullanır.

Zorunlu olmayan analitik, reklam veya yeniden hedefleme teknolojileri geçerli mevzuatın gerektirdiği tercih/onay mekanizması kurulmadan varsayılan olarak çalıştırılmamalıdır.

Bu metin, çerezlerin yanında `localStorage` ve `sessionStorage` gibi çerez olmayan tarayıcı depolama teknolojilerini de şeffaflık amacıyla ayrıca açıklar.

## 2. Zorunlu / hizmet için gerekli çerezler

| Teknoloji | Kim için / nerede | Amaç | Tür | Süre |
|---|---|---|---|---|
| `ege_admin_session` | yalnız yönetim paneline giriş yapan yetkili kullanıcılar | admin oturumunun güvenli şekilde sürdürülmesi | Zorunlu | en çok 8 saat; güvenlik kurallarına göre yenilenebilir/sona erdirilebilir |
| Clerk oturum çerezleri | müşteri hesabı (`/account`) giriş/oturum akışı | kimlik doğrulama ve müşteri oturumu | Hesap özelliği için zorunlu | Clerk'in aktif yapılandırmasına ve oturum politikasına göre |

Clerk çerez adları ve süreleri sağlayıcı yapılandırmasına göre değişebileceğinden, sabit olmayan teknik ayrıntılar bu politikada gerçeğe aykırı kesin değer olarak yazılmaz.

## 3. Tarayıcı depolaması — çerez değildir

| Anahtar | Depolama | Amaç | Tür | Silme |
|---|---|---|---|---|
| `ege-cart` | localStorage | sepet ürünleri ve adetleri | İşlevsel / talep edilen alışveriş işlevi | sepetten çıkarma veya tarayıcı site verilerini silme |
| `ege-favorites` | localStorage | favori ürünleri hatırlama | İşlevsel | favoriden çıkarma veya tarayıcı site verilerini silme |
| `ege-compare` | localStorage | karşılaştırma listesini hatırlama | İşlevsel | listeden çıkarma veya tarayıcı site verilerini silme |
| `ege-order-attempt` | sessionStorage | aynı siparişin yanlışlıkla iki kez gönderilmesini azaltmak için tek seferlik işlem anahtarı | Zorunlu / işlem güvenliği | sekme/oturum sona erdiğinde |
| `ege-service-attempt` | sessionStorage | aynı servis talebinin yanlışlıkla iki kez gönderilmesini azaltmak için tek seferlik işlem anahtarı | Zorunlu / işlem güvenliği | sekme/oturum sona erdiğinde |

Bu tarayıcı depoları reklam profili oluşturma amacıyla kullanılmaz.

## 4. First-party analytics — V1'de varsayılan kapalı

Kod tabanında Ege Teknik'e ait first-party analytics altyapısı bulunmaktadır. Bu sistem etkinleştirildiğinde sunucu rastgele bir ziyaretçi kimliği üretir ve `ege_vid` adlı first-party, `HttpOnly`, `SameSite=Strict` çerezi en fazla 180 gün süreyle kullanabilir. Bu tanımlayıcı IP adresi veya User-Agent bilgisinden türetilmez.

Analytics etkin olduğunda olay tablosunda ham IP adresi veya ham User-Agent saklanmaz; User-Agent yalnız kaba cihaz sınıflandırması için işlenir ve harici referrer tam URL yerine yalnız hostname'e indirgenir.

**V1 güvenli varsayılanı:** `ANALYTICS_ENABLED` açıkça `true` yapılmadıkça analytics endpoint'i veri kaydetmez ve `ege_vid` çerezi oluşturmaz. Analytics yeniden etkinleştirilmeden önce gerekli hukuki sebep, çerez tercihi/onay gereksinimi ve bu politika yeniden değerlendirilmelidir.

## 5. Otomatik üçüncü taraf ağ istekleri

Kaynak kod denetiminde public storefront'un bazı statik sayfalarında aşağıdaki harici kaynakların tarayıcı tarafından otomatik istekle yüklendiği tespit edilmiştir:

- Google Fonts / Google Fonts static kaynakları (`fonts.googleapis.com`, `fonts.gstatic.com`),
- Tailwind CSS CDN (`cdn.tailwindcss.com`).

Bu istekler çerez bırakmasa dahi kullanıcının IP adresi, User-Agent gibi standart ağ/HTTP bilgilerinin ilgili üçüncü taraf altyapısına ulaşmasına neden olabilir. Bu nedenle söz konusu kaynaklar yalnız "çerez yok" gerekçesiyle kişisel veri veya yurt dışı aktarım değerlendirmesinin dışında kabul edilmez.

V1 yayını öncesinde tercih edilen teknik çözüm bu statik bağımlılıkların mümkün olduğu ölçüde self-host / build-time kaynaklara taşınmasıdır. Taşınmadıkları sürece KVKK yurt dışı aktarım değerlendirmesinde ayrıca ele alınmalıdır.

WhatsApp gibi dış bağlantılar kullanıcı tıklamasıyla açılır; sırf sayfanın yüklenmesi nedeniyle WhatsApp'a otomatik istek gönderildiği varsayılmaz.

## 6. Diğer teknik sağlayıcılar

Mevcut mimaride Vercel barındırma/deployment, Neon PostgreSQL veritabanı ve Clerk müşteri hesabı/kimlik doğrulama hizmetleri kullanılmaktadır. Sentry geçici hata izleme/teşhis denemesi kapsamındadır ve kaldırılabilir.

YouTube, Meta Pixel, Google Analytics veya benzeri gömülü/ölçüm servisleri ileride devreye alınırsa, bunların fiili veri ve çerez davranışı incelenmeden zorunlu olarak sınıflandırılmaz ve gerekli tercih/onay altyapısı kurulmadan varsayılan açık hale getirilmez.

## 7. Çerez tercihleri

Yayın anında yalnız zorunlu/işlevsel teknolojiler kullanılıyorsa gereksiz bir pazarlama onayı talep edilmez.

Zorunlu olmayan analitik veya pazarlama teknolojileri devreye alınırsa tercih ekranı en az şu prensipleri sağlamalıdır:

- zorunlu olmayan teknolojiler varsayılan olarak kapalı,
- "yalnızca gerekli" seçeneği kolay erişilebilir,
- kabul ve ret seçenekleri karşılaştırılabilir görünürlükte,
- tercihler sonradan değiştirilebilir,
- verilen tercih teknik olarak kaydedilebilir,
- pazarlama tercihi sipariş vermenin koşulu yapılamaz.

## 8. Tarayıcı üzerinden kontrol

Tarayıcı ayarlarınızdan çerezleri ve site verilerini silebilir veya engelleyebilirsiniz. Zorunlu oturum/depolama mekanizmalarının engellenmesi halinde müşteri hesabı, sepet veya güvenli sipariş işlemleri beklendiği şekilde çalışmayabilir.

## 9. Değişiklikler

Yeni analitik, reklam, gömülü üçüncü taraf içerik veya benzeri teknoloji eklenmeden önce bu politika ve gerekiyorsa tercih/consent mekanizması güncellenmelidir. Değişiklikler sürümlenerek yayımlanır.

---

**Yayın öncesi teknik kontrol:** Production üzerinde aktif cookie/localStorage/sessionStorage anahtarları, Clerk oturum davranışı, public storefront'un harici ağ istekleri ve Sentry'nin fiili durumu tarayıcı DevTools üzerinden son kez doğrulanmalıdır.
