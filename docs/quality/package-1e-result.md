# Paket 1E — Hero Slider + Klima Rehberi SEO + Google Maps Result

28 Eylül 2026. Paket 1C/1D tasarım sistemi korunarak ana sayfa hero'su, Klima Rehberi, iletişim konumu ve teknik SEO iyileştirildi. Finance, PayTR, admin, migration ve ödeme backend'ine dokunulmadı. DB yazımı, deploy, merge veya push yapılmadı.

## Branch

`quality/package-1`

## Start HEAD

`c6e56e6`: Paket 1D. Başlangıç kontrolünde dal ve HEAD beklendiği gibiydi; çalışma ağacında izlenmeyen yerel dosyalar dışında değişiklik yoktu.

## End HEAD

Bu raporu içeren commit (`feat(storefront): add premium hero carousel, Klima Rehberi and mapped location`).

## Hero slider

- **Slaytlar.** Dört slayt var ve hepsi gerçek seri verisine dayanıyor:
  1. **Airy.** Renk değiştirici ve katalogdan canlı fiyat/stok kartı korundu.
  2. **Fairy.** Kapasite aralığı, enerji sınıfı ve başlangıç fiyatı katalogdan okunuyor.
  3. **Pular & Aphro.** İki ürün tek sahnede; başlangıç fiyatları ve kapasite katalogdan geliyor.
  4. **Akıllı Klima Seçici / keşif.** Kapasite basamakları ana sayfadaki ihtiyaç kartlarıyla aynı metni kullanıyor.
- **Fiyat kuralı.** Fiyatlar HTML'e yazılmadı; mevcut "tek fiyat kaynağı" testi geçiyor.
- **Görseller.** Yalnız yerel GREE ürün fotoğrafları kullanıldı. Her slaytın kendi tonal sahnesi var (mint, gök, kum, koyu yeşil), bu yüzden beyaz ürünler beyaz fonda kaybolmuyor.
- **Autoplay.**
  - Slaytlar 6,5 saniyede bir değişiyor. İlerleme çubuğu, sekme etiketinin altında aynı süreyle doluyor.
  - Masaüstünde fare üzerindeyken ve klavye odağı içerideyken duruyor; ayrılınca kaldığı yerden devam ediyor.
  - Önceki/sonraki okları, sekme veya kaydırma ile yapılan manuel geçişte kalıcı olarak duruyor.
  - Oynat/Durdur düğmesi her zaman var (WCAG 2.2.2).
  - Sekme arka plandayken sayaç duruyor.
- **Kontroller.**
  - Sekme listesi (`role=tablist`, `aria-controls`, gezinebilir `tabindex`) ←/→/Home/End tuşlarıyla çalışıyor.
  - Önceki, sonraki ve oynat/durdur düğmeleri 44 px ve `aria-label` taşıyor.
  - Aktif olmayan slaytlar `aria-hidden` + `inert`.
  - Canlı bölge (`aria-live`) autoplay sırasında kapalı, durunca `polite`.
- **Mobil.**
  - Kaydırma (swipe) destekli: dikey kaydırmaya izin veriliyor (`touch-action: pan-y`), 40 px'lik yatay eşik var.
  - Görsel üstte, metin altta; ikinci cümleler mobilde gizleniyor.
  - Ürün kartı kompakt ve iki düğme yan yana.
  - Noktalar yalnız çubuk olarak görünüyor ama etiketleri ekran okuyucuya açık.
- **Reduced motion.** `prefers-reduced-motion` açıkken autoplay kendiliğinden hiç başlamıyor, tüm geçişler kapanıyor.
- **CLS.** Tüm slaytlar aynı ızgara hücresinde üst üste duruyor ve kontrollerin yeri script'ten önce ayrılıyor. Ölçülen CLS: 1440'ta 0,018, 390'da 0,0002.
- **Performans.** Yalnız ilk görsel `fetchpriority="high"`, diğerleri lazy. Kütüphane yok; yaklaşık 3 KB özel JS.
- **Hızlı erişim.** Hero altındaki dört hızlı erişim yolu ve güvenceler, hero'nun altında ayrı bir şerit olarak korundu.

## Klima Rehberi

- **Mimari.**
  - Rehber artık `scripts/build-klima-rehberi.mjs` ile üretilen statik HTML.
  - İçerik kaynağı `scripts/klima-rehberi/guides-*.mjs`.
  - Çıktılar hub (`blog.html`), 16 makale (`rehber/*.html`) ve `sitemap.xml`.
  - Metin, başlıklar, breadcrumb ve structured data JavaScript olmadan da belgede duruyor.
  - `--check` modu ve test, commit'lenen sayfaların üreticiyle birebir aynı olmasını garanti ediyor.
- **İçerik.** Önceki 15 yazı, gövdesi aynı olan jenerik tek bir şablon metin gösteriyordu. Şimdi 16 özgün rehber var:
  - Seçim (7): klima seçimi, BTU hesabı, 9/12/18/24 bin farkları, mekâna göre seçim (yazlık, salon, ofis, mağaza), salon tipi, multi sistem, ikinci el kontrol listesi.
  - Teknoloji (4): inverter, enerji sınıfı + SEER/SCOP + elektrik tüketimi, Wi-Fi, GREE seri karşılaştırması.
  - Montaj ve bakım (3): montaj öncesi, yerinde keşif, bakım ve temizlik.
  - Arıza (2): soğutmama, su akıtma.
- **Veri kaynağı.**
  - Seri değerleri (enerji sınıfı, SEER, Wi-Fi, filtre, renk, iç ünite genişliği, kapasite aralıkları) doğrulanmış `catalog-enrichment` verisinden alındı.
  - BTU örnekleri sitedeki Klima Seçici formülüyle birebir hesaplandı.
  - Enerji sınıfı aralıkları AB 626/2011 tablosundan alındı.
  - Seri tablosundaki "güncel başlangıç fiyatı" hücreleri katalogdan canlı okunuyor; hiçbir rehberde fiyat yazılı değil.
- **Görseller.**
  - Ürün rehberlerinde yerel resmî GREE ürün fotoğrafları kullanıldı.
  - Kavram rehberleri için Ege Teknik'e özel 12 teknik çizim hazırlandı (kapasite ölçeği, enerji etiketi, split montaj şeması, multi sistem, inverter grafiği, Wi-Fi, mekân türleri, bakım takvimi, arıza kontrolü, drenaj, keşif planı, ikinci el kontrol listesi).
  - Stok fotoğraf, filigran veya alakasız görsel kullanılmadı.
  - Gerçek yaşam alanı veya montaj fotoğrafı elde olmadığı için bunlar yerine teknik çizim kullanıldı; uydurma fotoğraf yok.
- **Kategoriler.** Hub'da 4 kategori için çapa bağlantıları, 3 öne çıkan rehber, Klima Seçici bandı (BTU kısayollarıyla), kategori bölümleri, ürün kategorisi bağlantıları ve CTA var.
- **Admin yazıları.** Admin'den yazı eklenirse ayrı bir "Güncel yazılar" bölümünde görünüyor; o zamana kadar gizli.
- **Internal links.** Her rehberde şunlar var:
  - "Bu rehberde" içindekiler bölümü (masaüstünde yapışkan yan menü).
  - Metin içi ürün, seçici, servis ve iletişim bağlantıları.
  - "İlgili ürünler ve hizmetler" düğmeleri.
  - Üç ilgili rehber kartı.
  - Keşif/e-posta CTA'sı.
- **Eski adresler.** `article.html?slug=…` biçimindeki eski adresler Next'te 308 ile yeni sayfaya yönleniyor (`lib/guide-redirects.ts`). İstemci tarafında aynı haritayla yedek yönlendirme var. Bilinmeyen slug için dürüst bir "Aradığınız yazı bulunamadı" durumu gösteriliyor.

## SEO

- **Title ve meta.** Her rehbere özgün title (70 karakteri geçmez) ve meta description (90–165 karakter, tekrarsız) yazıldı.
- **Canonical.** Hub ve tüm rehberlerde var. Ayrıca iletişim, katalog, servis, seçici, bölgeler ve spot sayfalarına eksik olan canonical eklendi.
- **OG.** Rehberlerin her biri için 1200×630 OG görseli üretildi. Ana sayfa ve hub için ayrı OG görselleri var; OG ve Twitter meta etiketleri eklendi.
- **Schema.** Her rehberde JSON-LD `BreadcrumbList` + `Article` var. `FAQPage` yalnız SSS'si sayfada görünen rehberlerde ve birebir aynı metinle ekleniyor (test ediliyor). Hub'da `CollectionPage` + `ItemList` var.
- **Yorum/puan verisi yok.** Review veya AggregateRating verisi eklenmedi; yasak hâlâ testte.
- **Başlık yapısı.** Her sayfada tek H1 var ve başlık seviyeleri atlanmıyor (test ediliyor). Görsellerde alt metni ile width/height bulunuyor.
- **Breadcrumb.** Tüm rehberlerde görünür breadcrumb ve schema var.
- **Sitemap.** 16 rehber `lastmod` ile eklendi. Kişisel sayfalar (favoriler, karşılaştır) çıkarıldı. robots.txt değişmedi.

## Google Maps

- **Doğrulanan adres.**
  - Adres: İkiçeşmelik Mahallesi Süleyman Demirel Bulvarı, Ege Uluçınar Koop. No:13/1D, 09400 Kuşadası/Aydın.
  - Repo, llms.txt ve yasal taslaklardaki adres, işletmenin Google İşletme Profili ile karşılaştırıldı (kullanıcının Chrome'unda, `share.google` bağlantısı). Adres ve telefon birebir aynı. Koordinat: 37.8542159, 27.2652041.
  - Yandex'teki eski bir kayıt farklı bir adres gösteriyor; o kayıt kullanılmadı.
- **Harita.** İletişim sayfasında "Bizi ziyaret edin" bölümü var:
  - Görünür açık adres (`<address>`).
  - "Yol tarifi al" ve "Google Haritalar'da aç".
  - E-posta, telefon ve hizmet bölgesi bilgisi.
  - Başlıklı (`title`), lazy yüklenen Google Maps iframe'i.
  - Embed'in doğru işletme kartını ve pini gösterdiği kullanıcının Chrome'unda doğrulandı.
- **Yol tarifi.** `https://www.google.com/maps/dir/?api=1&destination=…` bağlantısının Chrome'da işletmeye rota açtığı doğrulandı.
- **Ana sayfa.** İkinci bir harita eklenmedi. Hizmet bölgesi haritasının yanına kompakt bir "Ege Teknik nerede?" kartı kondu: adres, yol tarifi ve iletişim/harita bağlantısı.
- **CSP.**
  - Yalnız statik politikaya `frame-src https://www.google.com` eklendi. Script, style, connect veya img kaynağı eklenmedi.
  - Wildcard ve `unsafe-eval` yok; `script-src 'self'` aynen korunuyor.
  - JSON-LD veri blokları çalıştırılabilir olmadığı için hash toplamaya dahil edilmiyor.
  - Admin/app politikası değişmedi.
  - Build sonrası `next start` ile gerçek başlık doğrulandı.
- **Gizlilik.** Harita altında "Harita Google Haritalar tarafından sunulur; Google'ın gizlilik koşulları uygulanır" notu var. Hukuki gözden geçirme notu olarak: gizlilik metnine Google Maps embed'inin eklenmesi önerilir.

## Contact UX

- **Kanal sırası.** E-posta (`mailto:info@egeteknik.tr`) birincil yol olarak kaldı. Ardından telefon, yol tarifi ve harita geliyor. WhatsApp ikincil.
- **Form.** 1D'deki gerçek backend'e bağlı form korundu:
  - Alanlar: ad, e-posta, telefon (isteğe bağlı), şehir, konu, mesaj.
  - Telefon veya e-postadan biri zorunlu.
  - Başarı mesajı yalnız sunucu yanıtıyla gösteriliyor.
- **Yardım düğmesi.** Yuva korundu; sahte AI sohbeti yok.

## Link audit

- **Otomatik tarama.** 117 sayfa tarandı: 1D'deki 100 sayfa, 16 rehber ve bilinmeyen slug durumu. Şunların hiçbiri çıkmadı:
  - boş, `#` veya `javascript:` href
  - eksik anchor
  - boş section
  - metinde undefined/null/NaN
  - kırık görsel
  - dahili 404
  - CSP ihlali
  - konsol hatası
- **Bilinen istisnalar.**
  - `/account` bir Next/Clerk rotası olduğu için QA sunucusunda yok; üretimde oturum açmaya yönlendiriyor.
  - `/api/checkout/charges` 503'ü QA sunucusunun bilinçli yanıtı.
- **Statik test.** Bütün statik sayfalar ve rehberlerdeki her dahili href'in bir dosyaya çözüldüğünü ve her `#anchor`'ın var olduğunu doğrulayan bir test eklendi. Aynı test `mailto` ve `tel` değerlerini de kontrol ediyor.
- **Harici bağlantılar (46).**
  - 41 belge bağlantısı (1D'de 200/206 doğrulandı).
  - `wa.me`
  - Google `share` bağlantısı
  - Google Maps yol tarifi (Chrome'da doğrulandı)
  - Wi-Fi kurulum PDF'i (belge listesinde, doğrulandı)
  - `mailto` / `tel`

## Mobile QA

- **Yatay taşma yok.** Ana sayfa, hub, iki rehber ve iletişim sayfası 1440 / 1280 / 1024 / 768 / 430 / 390 / 375 genişliklerinde tarandı (35 kombinasyon). Hiçbirinde yatay taşma, kırık görsel veya konsol hatası çıkmadı.
- **Düzen.**
  - 768–1023 aralığında hero iki kolonlu.
  - 767 ve altında görsel üstte.
  - Tablolar mobilde odaklanabilir, yatay kaydırılabilen bölge olarak davranıyor.

## Accessibility

axe-core WCAG 2.0/2.1/2.2 A–AA taraması 18 sayfa/görünüm kombinasyonunda yapıldı: **0 ihlal**. Taranan görünümler:

- Ana sayfa: 1. slayt, koyu 4. slayt, 2. ve 3. slayt
- İletişim + harita (masaüstü ve mobil)
- Hub (masaüstü ve mobil)
- Dört rehber
- Bulunamadı durumu
- Bölgeler, seçici, ürün, katalog

Skip link, `<base href="/">` olan rehber sayfalarında da doğru yere gidiyor.

## Performance

| Sayfa | CLS | LCP (yerel) |
|---|---|---|
| Ana sayfa 1440 / 390 | 0,018 / 0,0002 | 372 / 228 ms |
| Hub 1440 / 390 | 0,018 / 0 | 408 / 196 ms |
| Rehber 1440 / 390 | 0,018 / 0 | 312 / 168 ms |
| İletişim 1440 / 390 | 0,017 / 0,034 | 228 / 160 ms |

- **Rehber CSS.** `guide.css` (~16 KB) yalnız rehber sayfalarında yükleniyor.
- **Görseller.** SVG çizimler 2–5 KB; rehber görselleri lazy.
- **Harita.** Maps iframe'i lazy olduğu için sayfayı bloke etmiyor.

## CSP

Statik politika:

```
script-src 'self'; frame-src https://www.google.com; default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https:; connect-src 'self'; upgrade-insecure-requests
```

## Network ve console

- **Tarama.** Taramada 4xx/5xx (bilinen QA istisnaları hariç), başarısız fetch, CORS veya CSP ihlali yok.
- **Hero testi.** Autoplay, hover, klavye, reduced-motion ve swipe testleri tarayıcıda hatasız geçti.

## Screenshots

`docs/quality/package-1e-screenshots/`:

- ana sayfa masaüstü ve mobil
- hero slayt 1, 2 ve 3 (masaüstü)
- hero slayt 4 (mobil)
- akıllı seçici (sonuçla)
- Klima Rehberi masaüstü ve mobil
- rehber detayı masaüstü ve mobil
- iletişim + Google Maps masaüstü ve mobil
- footer
- ürün detayı
- ana sayfadaki "Ege Teknik nerede?" kartı

**Harita ekran görüntüleri hakkında not:** Ekran görüntüsü alınan sandbox Google'a erişemiyor. Bu yüzden iletişim ekran görüntülerindeki harita karesi, aynı embed URL'sinin aynı boyutta kullanıcının gerçek Chrome'unda alınmış görüntüsüyle dolduruldu. Sayfa, CSP ve iframe gerçek; yalnız iframe'in içeriği bu şekilde yerleştirildi. Gerçek embed ayrıca Chrome'da doğrulandı.

## Tests

| Kontrol | Sonuç |
|---|---|
| Lint | PASS |
| Typecheck | PASS |
| Yeni Paket 1E testleri | 22/22 PASS. Kapsam: hero işaretlemesi, görseller, CSS, autoplay, hover/odak duraklatma, manuel durdurma, reduced motion, üretici senkronu, SEO işaretleri, JSON-LD/FAQ uyumu, görseller, internal link, hub, motion, legacy yönlendirme, bulunamadı durumu, adres tutarlılığı, harita/iletişim, CSP, satır içi script yokluğu, sıfır ölü link |
| Paket 1C / 1D testleri | PASS |
| Tam paket | 937 test. Başarısız olanlar yalnız bu pakette de önceden başarısız olan `analytics-sales` (saat dilimi) ve `migrator` (pg) |
| Build | PASS (`LOCAL_BUILD_NO_UPLOAD=1`; admin fontu mock'landı). `next start` ile legacy 308 yönlendirmeleri, statik rehber sayfaları ve CSP başlığı doğrulandı |

**Test güncellemeleri** (kapsam daraltılmadan):

- `reviews-storefront`: JSON-LD artık izinli. Review/AggregateRating/rating verisi yasağı, rehber sayfaları dahil her yerde sürüyor; structured data yalnız üretilen rehber sayfalarında olabilir.
- `storefront-claims`: Editoryal rehber sayfaları kendi testiyle denetleniyor. Bayilik, garanti, taksit, kampanya, ücretsiz, orijinal gibi tüm ticari iddia kalıpları orada da yasak. Yalnız standart anlatımı için enerji sınıfı ve yüzde istisna; eski `articles` istisnası kaldırıldı.

## Finance/PayTR overlap

`git diff --name-only c6e56e6..HEAD`: finance, PayTR, admin, migration veya ödeme dosyası yok.

- **Konfigürasyon ve lib:** `next.config.ts` (yalnız legacy rehber yönlendirmeleri), `lib/guide-redirects.ts` (yeni), `lib/security-headers.ts` (frame-src), `lib/static-script-hashes.ts` (JSON-LD hariç).
- **Storefront:** `public/*`, `scripts/build-klima-rehberi.mjs`, `scripts/klima-rehberi/*`.
- **Testler ve dokümanlar:** `tests/*`, `docs/quality/*`.

## Remaining blockers

1. **Canlı veritabanı** (1C'den devreden). Canlı veritabanında zenginleştirme importu yok; ürün görselleri canlıda henüz yok. Rehberler ve hero yerel görsellerle çalıştığı için bu engelden etkilenmiyor. Katalogdan okunan fiyat alanları canlıda gerçek fiyatları gösterir.
2. **Hukuki not.** Gizlilik/çerez metnine Google Maps embed'inin (üçüncü taraf) eklenmesi önerilir. KVKK aydınlatma metni hâlâ "yayınlanmamış" durumda (mevcut durum, bu paketin kapsamı dışında).
3. **Preview doğrulaması.** Deploy sonrası şunlar doğrulanmalı: harita iframe'i, legacy 308 yönlendirmeleri ve `sitemap.xml`.

Bu maddeler Paket 1E ölçütlerini engellemiyor; üretim ortamı ve hukuk tarafında yapılacak işlerdir.

## FINAL VERDICT

`PASS — PAKET 1E COMPLETE`
