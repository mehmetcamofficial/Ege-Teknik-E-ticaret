# Ege Teknik E‑Ticaret

Ege Teknik için geliştirilen klima, iklimlendirme ve ikinci el ürün odaklı e‑ticaret platformu.

Production: https://egeteknik.tr

> Bu repository aktif geliştirme içindir. Secret, veritabanı parolası, API anahtarı veya production credential bilgileri repository'ye commit edilmemelidir.

## Proje kapsamı

Platformun ana kapsamı:

- GREE klima ve iklimlendirme ürünlerinin kataloglanması ve satışı
- İkinci el / spot ürünlerin yönetimi
- Kategori, marka, ürün, fiyat ve stok yönetimi
- Favoriler, karşılaştırma ve sepet akışları
- Checkout ve sipariş oluşturma
- Stok rezervasyonu ve sipariş transaction'ları
- Yönetim paneli
- Müşteri hesabı
- Blog / içerik ve temel SEO altyapısı
- Responsive web arayüzü

## Teknoloji yığını

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- PostgreSQL
- Neon PostgreSQL
- Drizzle ORM / Drizzle Kit
- Clerk — müşteri hesabı ve kimlik doğrulama
- Vercel Blob — gerektiğinde dosya/görsel depolama
- Vercel — deployment ve hosting
- Sentry — geçici observability / hata teşhis denemesi

## Mimari yaklaşım

Projede mümkün olduğunca aşağıdaki prensipler izlenir:

- Önce çalışan en basit çözüm
- Ölçmeden optimize etmeme
- İhtiyaç doğmadan mimari karmaşıklık eklememe
- Kaizen
- Clean Code
- SOLID
- DRY, ancak gereksiz abstraction oluşturmadan
- YAGNI
- OWASP güvenlik prensipleri
- Zero‑Trust yaklaşımı
- 12‑Factor App prensipleri
- CI/CD quality gates
- Incident / postmortem öğrenme döngüsü

Amaç; hızlı geliştirilebilen ancak production ortamında stabil, anlaşılır, güvenli ve sürdürülebilir bir sistem oluşturmaktır.

## Veritabanı ve ortam ayrımı

Uygulama PostgreSQL kullanır ve bağlantı `DATABASE_URL` üzerinden sağlanır.

Development, Preview ve Production ortamları birbirinden ayrıdır. Production veritabanı için ayrı Neon branch kullanılır. Ortam/branch korumaları yanlış veritabanına bağlanma riskini azaltmak amacıyla fail‑closed tasarlanmıştır.

Migration komutları:

```bash
pnpm db:generate
pnpm db:migrate
```

Production migration işlemleri kontrollü yapılmalı; destructive migration veya veri silme işlemleri otomatik varsayılmamalıdır.

## Sipariş ve stok güvenliği

Sipariş oluşturma ve stok değişiklikleri yalnızca istemci durumuna güvenmez. Kritik işlemler sunucu/veritabanı tarafında yürütülür.

Sipariş kalemlerinde gerekli ürün/fiyat/vergi bilgilerinin snapshot'larının korunması, sonradan katalog verisi değişse dahi geçmiş siparişin kendi tarihsel durumunu koruması için kullanılır.

Stok rezervasyonu ve sipariş oluşturma işlemlerinde atomik transaction yaklaşımı tercih edilir.

## Kimlik doğrulama

Müşteri hesabı tarafında Clerk kullanılmaktadır.

Admin erişimi müşteri hesabından ayrı tutulur. Admin endpoint'lerinde authorization kontrolleri yalnızca UI gizlemeye bırakılmamalıdır; sunucu tarafında uygulanmalıdır.

## Analytics ve gizlilik

Uygulamanın first‑party analytics yaklaşımı veri minimizasyonunu hedefler. Ziyaretçi tanımlamasında uygulama tarafından oluşturulan rastgele identifier kullanılır. Analytics kayıtlarında gereksiz kişisel veri toplamaktan kaçınılmalıdır.

Gizlilik ve KVKK metinleri uygulamanın gerçek veri akışıyla uyumlu tutulmalıdır.

## Sentry durumu

Sentry şu anda hata izleme ve observability amacıyla **geçici deneme** olarak projeye entegredir.

Bu entegrasyon kalıcı bir mimari bağımlılık olarak kabul edilmemelidir. Deneme tamamlandığında Sentry kapatılabilir ve ilgili environment variable / SDK yapılandırmaları kaldırılabilir.

Sentry açıkken veri minimizasyonu uygulanmalı; gereksiz kullanıcı bilgisi, request body veya hassas veri telemetry'ye gönderilmemelidir. Sampling oranları production trafiğine uygun şekilde sınırlı tutulmalıdır.

## Environment variables

Gerçek değerler yalnızca güvenli environment yönetiminde tutulmalıdır. Örnek kategoriler:

```text
DATABASE_URL=
APP_ENV=
NEON_BRANCH_ID=
EXPECTED_NEON_PRODUCTION_BRANCH_ID=

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

# Sentry — geçici / opsiyonel
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_DSN=
```

`.env`, production database credentials, private API keys ve benzeri secret'lar GitHub'a gönderilmemelidir.

## Local development

Gereksinimler:

- Node.js >= 22.13.0
- pnpm 11
- PostgreSQL/Neon development database erişimi

Kurulum:

```bash
pnpm install
pnpm dev
```

Kalite kontrolleri:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Production'a çıkmadan önce en az lint, typecheck, test ve production build kontrollerinin başarılı olması beklenir.

## Deployment

Ana deployment platformu Vercel'dir.

Ortamlar:

- Development — yerel geliştirme
- Preview — değişikliklerin production öncesi doğrulanması
- Production — `egeteknik.tr`

Preview ve Production environment variable'ları birbirinden bağımsız yönetilmelidir.

## Güvenlik

Temel güvenlik yaklaşımı:

- Secret'ları source code'a koymamak
- Server-side authorization
- Admin login koruması
- Rate limiting / brute-force koruması
- Security headers
- Input validation
- Veritabanı transaction'ları
- Environment isolation
- Least privilege
- Production değişikliklerinde kontrollü migration/deployment

İleri aşamada deterministik WAF/Firewall kuralları ve Security Watch, Attack Response ve Bug/Incident otomasyonları ayrı bir operasyon fazında ele alınacaktır.

## Ödeme

Ödeme entegrasyonu ayrı bir fazdır. Kart verilerinin Ege Teknik sunucularında saklanmaması temel tasarım gereksinimidir. Ödeme sağlayıcısı entegrasyonu sağlayıcının güvenli ödeme akışı üzerinden yapılmalıdır.

## Repository çalışma düzeni

Aktif geliştirmede küçük, anlaşılır ve geri alınabilir commit'ler tercih edilir.

Önerilen commit örnekleri:

```text
feat: ...
fix: ...
security: ...
docs: ...
refactor: ...
test: ...
chore: ...
```

Büyük ve ilgisiz değişiklikleri tek commit altında toplamaktan kaçınılır.

## Durum

Backend, PostgreSQL/Neon entegrasyonu, temel e‑ticaret akışları, admin altyapısı ve production deployment temeli oluşturulmuştur. Ödeme ve ileri seviye güvenlik/operasyon otomasyonları ayrı fazlar halinde ilerletilmektedir.

---

**Ege Teknik** — Ege Bölgesi klima, iklimlendirme, satış ve teknik servis platformu.
