> **RELEASE CANDIDATE — LEGAL REVIEW REQUIRED · NOT YET PUBLISHED**
> Bu metin, Ege Teknik sitesinde kullanılan çerez ve tarayıcı depolama teknolojilerini açıklar. Yayın öncesinde fiili üretim davranışı tarayıcı üzerinden son kez doğrulanmalıdır.

# ÇEREZ VE TARAYICI DEPOLAMA BİLGİLENDİRMESİ

## 1. Genel yaklaşım

Ege Teknik, sitenin çalışması için gerekli teknolojiler ile kullanıcının talep ettiği işlevleri sağlayan depolama mekanizmalarını veri minimizasyonu prensibiyle kullanır.

Zorunlu olmayan analitik, reklam veya yeniden hedefleme teknolojileri geçerli mevzuatın gerektirdiği tercih/onay mekanizması kurulmadan varsayılan olarak çalıştırılmaz.

Bu metin, çerezlerin yanında `localStorage` ve `sessionStorage` gibi çerez olmayan tarayıcı depolama teknolojilerini de şeffaflık amacıyla ayrıca açıklar.

## 2. Zorunlu / hizmet için gerekli çerezler

| Teknoloji | Kim için / nerede | Amaç | Tür | Süre |
|---|---|---|---|---|
| `ege_admin_session` | yalnız yönetim paneline giriş yapan yetkili kullanıcılar | admin oturumunun güvenli şekilde sürdürülmesi | Zorunlu | en çok 8 saat; güvenlik kurallarına göre yenilenebilir/sona erdirilebilir |
| Clerk oturum çerezleri | müşteri hesabı (`/account`) giriş/oturum akışı | kimlik doğrulama ve müşteri oturumu | Hesap özelliği için zorunlu | Clerk'in aktif yapılandırmasına ve oturum politikasına göre |
| `ege_analytics_consent` | storefront ziyaretçisi | ziyaretçinin analitik tercihini hatırlamak ve tercihi her sayfada tekrar sormamak | Tercih | en çok 365 gün; kullanıcı tercih ekranından değiştirilebilir |
| `ege_vid` | yalnızca analitik tercihi verilmiş ziyaretçi | analitik olaylarını ilişkilendirmek için sunucu tarafından üretilen rastgele ziyaretçi kimliği; IP veya cihaz bilgisinden türetilmez | Tercihe bağlı | en çok 180 gün; analitik izni kaldırıldığında sunucu tarafından silinir |

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

## 4. First-party ziyaretçi analitiği — yalnız tercih ile

Kod tabanında Ege Teknik'e ait first-party analytics altyapısı bulunmaktadır. Sistem iki ayrı kapı ile çalışır:

1. operasyonel/global anahtar olan `ANALYTICS_ENABLED` açıkça `true` olmalıdır,
2. ilgili ziyaretçinin `ege_analytics_consent` tercihi analitiğe izin vermelidir.

Bu iki koşuldan biri sağlanmıyorsa analytics endpoint'i ziyaret olayını kaydetmez ve analytics ziyaretçi kimliği oluşturmaz.

Ziyaretçi analitiğe izin verdiğinde sunucu rastgele bir ziyaretçi kimliği üretir ve `ege_vid` adlı first-party, `HttpOnly`, `SameSite=Strict` çerezi en fazla 180 gün süreyle kullanabilir. Bu tanımlayıcı IP adresi veya User-Agent bilgisinden türetilmez.

Analytics etkin olduğunda olay tablosunda ham IP adresi veya ham User-Agent saklanmaz; User-Agent yalnız kaba cihaz sınıflandırması için işlenir ve harici referrer tam URL yerine yalnız hostname'e indirgenir. Bu yapı ziyaretçi sayısı, yeni/geri dönen ziyaretçi, sayfa görüntüleme, ürün görüntüleme, cihaz kategorisi ve yönlendiren kaynak gibi toplu istatistikler üretmek için kullanılır.

Ziyaretçi analitik iznini daha sonra kapatırsa, tercih `ege_analytics_consent=0` olarak güncellenir ve mevcut `ege_vid` analytics kimliği sunucu tarafından silinir. Bundan sonraki sayfa görüntülemeleri analitik olay olarak kaydedilmez.

## 5. Tercih ekranı

İlk ziyarette analitik için önceden seçili kabul uygulanmaz. Kullanıcıya en az şu seçenekler sunulur:

- **Yalnızca gerekli** — analitik kapalı kalır,
- **Tercihler** — analitik seçeneği ayrı olarak yönetilebilir,
- **Tümünü kabul et** — analitik tercih açık hale gelir.

Tercihler daha sonra sitedeki **Çerez Tercihleri** kontrolünden yeniden değiştirilebilir. Analitik tercihi sipariş vermenin, müşteri hesabı açmanın veya servis talebi oluşturmanın koşulu değildir.

## 6. Otomatik üçüncü taraf ağ istekleri

V1 hardening kapsamında storefront'un önceki sürümlerinde bulunan Google Fonts, Tailwind Play CDN ve Google-hosted temsili görseller için otomatik tarayıcı istekleri kaldırılmıştır. Ana sayfa stilleri build-time üretilir; kullanılan temsili görseller first-party local asset olarak sunulur.

Bu nedenle bu kaynaklar bakımından sırf sayfa yüklenmesiyle `fonts.googleapis.com`, `fonts.gstatic.com`, `cdn.tailwindcss.com` veya `lh3.googleusercontent.com` adreslerine otomatik istek gönderilmesi amaçlanan Production davranışı değildir.

Bununla birlikte Vercel, Neon, Clerk ve geçici Sentry gibi aktif teknik sağlayıcıların gerçek veri akışı ayrıca değerlendirilmelidir. WhatsApp gibi dış bağlantılar kullanıcı tıklamasıyla açılır; sırf sayfanın yüklenmesi nedeniyle WhatsApp'a otomatik istek gönderildiği varsayılmaz.

## 7. Diğer teknik sağlayıcılar

Mevcut mimaride Vercel barındırma/deployment, Neon PostgreSQL veritabanı ve Clerk müşteri hesabı/kimlik doğrulama hizmetleri kullanılmaktadır. Sentry geçici hata izleme/teşhis denemesi kapsamındadır ve kaldırılabilir.

YouTube, Meta Pixel, Google Analytics veya benzeri gömülü/ölçüm servisleri ileride devreye alınırsa, bunların fiili veri ve çerez davranışı incelenmeden zorunlu olarak sınıflandırılmaz ve gerekli tercih/onay altyapısı kurulmadan varsayılan açık hale getirilmez.

## 8. Tarayıcı üzerinden kontrol

Tarayıcı ayarlarınızdan çerezleri ve site verilerini silebilir veya engelleyebilirsiniz. Zorunlu oturum/depolama mekanizmalarının engellenmesi halinde müşteri hesabı, sepet veya güvenli sipariş işlemleri beklendiği şekilde çalışmayabilir.

## 9. Değişiklikler

Yeni analitik, reklam, gömülü üçüncü taraf içerik veya benzeri teknoloji eklenmeden önce bu politika ve gerekiyorsa tercih/consent mekanizması güncellenmelidir. Değişiklikler sürümlenerek yayımlanır.

---

**Yayın öncesi teknik kontrol:** Production üzerinde `ege_analytics_consent` ve `ege_vid` davranışı; izin verilmeden analytics olayının kaydedilmediği; izin kaldırıldığında `ege_vid` çerezinin silindiği; Clerk oturum davranışı; public storefront'un harici ağ istekleri ve Sentry'nin fiili durumu tarayıcı DevTools üzerinden son kez doğrulanmalıdır.
