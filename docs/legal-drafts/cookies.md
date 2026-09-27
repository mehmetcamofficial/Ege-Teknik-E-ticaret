> **RELEASE CANDIDATE — LEGAL REVIEW REQUIRED · NOT YET PUBLISHED**
> Bu metin, Ege Teknik sitesinde kullanılan çerez ve tarayıcı depolama teknolojilerini açıklar. Yayın öncesinde fiili üretim davranışı tekrar doğrulanmalıdır.

# ÇEREZ VE TARAYICI DEPOLAMA BİLGİLENDİRMESİ

## 1. Genel yaklaşım

Ege Teknik, sitenin çalışması için gerekli teknolojiler ile kullanıcının talep ettiği işlevleri sağlayan depolama mekanizmalarını veri minimizasyonu prensibiyle kullanır.

Zorunlu olmayan analitik, reklam veya yeniden hedefleme teknolojileri devreye alınırsa, bunlar geçerli mevzuatın gerektirdiği tercih/onay mekanizması kurulmadan varsayılan olarak çalıştırılmamalıdır.

Bu metin, çerezlerin yanında `localStorage` ve `sessionStorage` gibi çerez olmayan tarayıcı depolama teknolojilerini de şeffaflık amacıyla ayrıca açıklar.

## 2. Zorunlu çerezler

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

Bu tarayıcı depoları tek başına reklam profili oluşturma amacıyla kullanılmaz.

## 4. First-party analytics ve teknik kayıtlar

Ege Teknik'in first-party analytics yapısı, veri minimizasyonunu esas alacak şekilde tasarlanmıştır. Teknik mimaride rastgele oluşturulan first-party ziyaretçi tanımlayıcıları ve sınırlı olay verileri kullanılabilir; ham IP adresi veya ham User-Agent bilgisinin analytics tablosunda profil oluşturma amacıyla saklanmaması esastır.

Bu analytics yapısı ile tarayıcı çerezleri aynı şey değildir. Yayın anında hangi olayların aktif olduğu ayrıca üretim davranışı üzerinden doğrulanmalıdır.

## 5. Üçüncü taraf hizmetler

Sitenin bazı alanlarında kullanılan teknik sağlayıcılar ağ isteği alabilir. Mevcut mimaride Vercel, Neon ve Clerk temel altyapı hizmetleridir. Sentry ise geçici hata izleme/teşhis denemesi kapsamında kullanılmaktadır.

Harici font, CDN, gömülü video veya başka üçüncü taraf içerik kullanılması halinde kullanıcının tarayıcısı ilgili sağlayıcıya doğrudan istek gönderebilir. Bu nedenle yeni bir üçüncü taraf kaynak eklenmeden önce çerez, tracking ve yurt dışı veri aktarımı etkisi ayrıca değerlendirilmelidir.

Özellikle YouTube, Google, Meta veya benzeri gömülü/ölçüm servisleri ileride devreye alınırsa, bunların fiili veri/çerez davranışı incelenmeden "zorunlu" olarak sınıflandırılmaz.

## 6. Çerez tercihleri

Yayın anında yalnız zorunlu/işlevsel teknolojiler kullanılıyorsa gereksiz bir pazarlama onayı talep edilmez.

Zorunlu olmayan analitik veya pazarlama teknolojileri devreye alınırsa tercih ekranı en az şu prensipleri sağlamalıdır:

- zorunlu olmayan teknolojiler varsayılan olarak kapalı,
- "yalnızca gerekli" seçeneği kolay erişilebilir,
- kabul ve ret seçenekleri karşılaştırılabilir görünürlükte,
- tercihler sonradan değiştirilebilir,
- verilen tercih teknik olarak kaydedilebilir,
- pazarlama tercihi sipariş vermenin koşulu yapılamaz.

## 7. Tarayıcı üzerinden kontrol

Tarayıcı ayarlarınızdan çerezleri ve site verilerini silebilir veya engelleyebilirsiniz. Zorunlu oturum/depolama mekanizmalarının engellenmesi halinde müşteri hesabı, sepet veya güvenli sipariş işlemleri beklendiği şekilde çalışmayabilir.

## 8. Değişiklikler

Yeni analitik, reklam, gömülü üçüncü taraf içerik veya benzeri teknoloji eklenmeden önce bu politika ve gerekiyorsa tercih/consent mekanizması güncellenmelidir. Değişiklikler sürümlenerek yayımlanır.

---

**Yayın öncesi teknik kontrol:** Production üzerinde aktif cookie/localStorage/sessionStorage anahtarları, Clerk oturum davranışı, first-party analytics olayları ve varsa üçüncü taraf network istekleri tarayıcı üzerinden yeniden doğrulanmalıdır.
