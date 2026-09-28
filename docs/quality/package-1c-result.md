# Paket 1C — Storefront Design Quality Result

28 Eylül 2026 · dal `quality/package-1` · yalnız storefront görsel kalite / UX kapsamı.
Finance, PayTR, admin finance, migration ve ödeme backend'ine dokunulmadı. DB yazımı, migration, deploy yapılmadı.

## Yöntem

- Tüm storefront tek tasarım sistemine taşındı: `public/store.css` (token → temel → header/nav → footer → kontroller → ürün kartı → katalog → ana sayfa → içerik sayfaları → checkout/formlar). `phase1.css`, `phase1b.css`, `phase1c.css` bu dosyada birleştirildi ve kaldırıldı; ürün detayı `product-detail.css` ile aynı token'ları kullanır.
- Görsel QA gerçek tarayıcıda (Chromium/Playwright) yapıldı: statik sayfalar üretimdeki **gerçek statik CSP** başlığıyla servis edildi; `/api/products` ve `/api/products/[id]` yanıtları üretimdeki `toCatalogListItem` / `toPublicProductDetail` projeksiyonlarıyla, üretim katalog satırları (fiyat/stok/kategori/seri, 87 ürün) + incelenmiş zenginleştirme veri seti (importer kuralıyla) üzerinden üretildi. BLOCKED 9 ürün listede yok.
- Resmî GREE ürün görselleri (veri setindeki 187 URL) kullanıcının onayıyla Chrome üzerinden indirilip QA sırasında tarayıcıya yerel olarak verildi; sandbox gree.com.tr'ye erişemiyor.
- Her büyük aşamadan sonra ekran görüntüsü alınıp değerlendirildi (tasarım sistemi → katalog → ana sayfa → ürün detayı → responsive/etkileşimler). Gree.com.tr ana sayfa, `/kategori/duvar-tipi-klimalar` ve `/urun/airy-12000-btu-h` masaüstünde kullanıcının Chrome'unda yan yana incelendi.

## Home

- Tailwind CDN + build-time dönüştürülen mockup ana sayfa tamamen kaldırıldı; ana sayfa artık diğer sayfalarla aynı header/footer ve aynı kart bileşenini kullanır. `scripts/build-home-css.mjs` ve `index.html`'i build sırasında değiştiren adım kaldırıldı (`build`: `next build`).
- Bölümler: hero showroom → seri keşfi + diğer ürün grupları → BTU/ihtiyaç keşfi → öne çıkan 8 ürün (katalog kartı) → güven (hizmet bölgesi, keşif, profesyonel montaj, satış sonrası, garanti bilgisi, iletişim/WhatsApp) → sipariş süreci → Spot Ürünler → rehber → keşif CTA.
- Ana sayfada hiçbir fiyat, enerji sınıfı, m² veya garanti süresi elle yazılmadı; tüm rakamlar sunulan katalogdan çalışma anında hesaplanır.

## Hero

- Büyük, kontrollü ürün kompozisyonu: tonal "stage" üzerinde GREE Airy (resmî görselden beyaz fon ayrıştırılmış, WebP 720/1200, `fetchpriority=high`, preload). Sağdaki boş beyaz alan kaldırıldı; ürün kartı stage'in üzerine bindirildi.
- Renk seçici (Beyaz/Siyah) iki gerçek katalog ürünü arasında geçiş yapar; görsel, ürün kimliği, fiyat, stok, spec chip'leri, favori ve sepete ekle birlikte değişir.
- Ürün adı / model kodu / fiyat (KDV dahil) / stok / BTU–enerji–Wi-Fi hiyerarşisi; "Ürünü incele" ve "Sepete ekle".
- İlk ekranda dört net yol: Klimaları incele · Klima seç · Keşif ve montaj · WhatsApp. Mobilde sıra: başlık → ürün → yollar (ürün ilk ekranda görünür).

## Series discovery

- Airy, Fairy, Pular, Aphro kartları: gerçek yerel görsel (resmî görselden kırpılmış WebP, srcset), doğrulanmış verilere dayanan kısa konumlandırma, çalışma anında hesaplanan kapasite aralığı, enerji sınıfı, başlangıç fiyatı, model sayısı ve kapasiteye göre kullanım senaryosu; "Seriyi incele" → filtreli katalog.
- Diğer gerçek gruplar: Salon tipi, Ticari klima (kaset, yer/tavan, karavan), Multi sistem, Isı pompası, Ev ürünleri — ürün sayıları katalogdan.
- BTU keşfi: 9.000 / 12.000 / 18.000 / 24.000 / 36.000+ (ticari) kartları, "küçük oda / oda ve küçük salon / salon / büyük alan / ticari alan" dili, katalogdan model sayısı; m² garantisi verilmez, Klima Seçici ve keşfe yönlendirilir.

## Catalog

- Kategori sekmeleri (sayılarla, radio semantiği), kapasite chip'leri katalogdaki gerçek BTU değerlerinden üretilir, seri/enerji/Wi-Fi seçenekleri sayılarla, stok, fiyat aralığı, arama.
- Sıralama: önerilen, fiyat artan, fiyat azalan, yeni ürün.
- Aktif filtreler tek tek kaldırılabilir buton + "Tümünü temizle"; başlık seçime göre değişir (ör. "GREE Airy Serisi"); sonuç sayısı canlı bölge.
- Mobil: alttan açılan filtre paneli (backdrop, Escape, odak yönetimi, "N ürünü göster"); masaüstünde yan panel.
- 24'lük sayfalama + ilerleme göstergeli "Daha fazla ürün göster"; yükleme sırasında aynı ölçüde skeleton kartlar.

## Product cards

- Tek ortak kart (katalog, ana sayfa, favoriler, ilgili ürünler): gerçek görsel (tonal stage, kontrollü oran), seri · kategori, ürün adı, model kodu, BTU (binlik ayırıcıyla), enerji sınıfı, Wi-Fi, KDV dahil fiyat, stok/tedarik durumu, favori, karşılaştır, sepete ekle/teklif, incele. Teklif ürünlerinde fiyat/stok gösterilmez.
- Mobilde katalog/favoriler yatay kompakt kart (görsel solda) — kart başına ~yarı yükseklik.

## Product detail

- Büyük galeri + küçük resimler (masaüstünde yapışkan), ürün adı, seri, model, fiyat, stok, kapasite/enerji/Wi-Fi özetleri, adet + sepete ekle, WhatsApp, bilgi al, **favori** ve **karşılaştır** (durum metniyle), teslimat/montaj notları, hizmet güvenceleri (hizmet bölgesi, keşif, satış sonrası).
- Yapışkan bölüm menüsü (Özellikler, Açıklama, Teknik özellikler, Belgeler, Montaj ve teslimat, Yorumlar); "Öne çıkan özellikler" yalnız API'nin doğrulanmış spec satırlarından (kapasite, enerji sınıfı, SEER/SCOP, ses, Wi-Fi, soğutucu, ölçü); grup halinde teknik tablo; belgeler yalnız gerçek bağlantılarla (katalog, kılavuz, enerji etiketi, Wi-Fi rehberi, ürün bilgi formu varsa).
- Mobilde ana satın alma kutusu ekrandan çıkınca görünen alt satın alma çubuğu; yükleme sırasında yer tutan skeleton (CLS 0.295 → 0).

## Mobile

- Test genişlikleri: 1440, 1280, 1024, 430, 390, 375. Tüm ana sayfa, katalog ve ürün detay sayfalarında yatay taşma yok, kırık görsel yok, konsol/CSP hatası yok.
- Header: <1024px'te soldan açılan menü (arama, kategori/seri kısayolları, tüm linkler), backdrop, Escape ile kapanma ve odak iadesi. Masaüstünde "GREE Klimalar" mega menüsü (kategoriler, seriler, kapasite, Klima Seçici) klavye ile de açılır (`:focus-within`).
- Seri, ihtiyaç ve öne çıkan ürünler mobilde kaydırmalı şeritler (scroll-snap, kenar boşluğu korunur).

## Accessibility

- axe-core (WCAG 2.0/2.1/2.2 A–AA) ana sayfa, katalog, ürün detayı × 1440/390: **0 ihlal** (renk kontrastı düzeltmesi sonrası).
- "İçeriğe geç" linki, tek odak stili, semantik başlıklar, landmark'lar (`nav` etiketli), ikon butonlarda `aria-label`, toggle'larda `aria-pressed`, menü/filtre panelinde `aria-expanded/aria-controls`, form etiketleri, 44px dokunma hedefleri, `prefers-reduced-motion`.

## Performance

- Yerel font: Plus Jakarta Sans değişken WOFF2 (latin 27 KB + latin-ext 22 KB, `font-display:swap`, preload; OFL lisansı dosyayla birlikte). Google Fonts / Material Symbols / Tailwind CDN bağımlılığı storefront'tan tamamen kalktı.
- Ana sayfa yerel görselleri WebP, toplam ~330 KB (tümü `width/height`, hero hariç `loading=lazy`, seri görselleri srcset).
- Ölçüm (yerel, ağ kısıtsız): Ana sayfa CLS 0.020 (1440) / 0.003 (390); katalog CLS 0.011; ürün detayı CLS 0. LCP öğesi hero görseli / ürün görseli.
- Katalog görselleri lazy; katalog 24'er ürün render eder.

## CSP

- CSP gevşetilmedi: `unsafe-eval`, wildcard, CDN eklenmedi. Ana sayfadaki inline script'ler kaldırıldı; statik politika artık `script-src 'self'` (hash bile gerekmiyor). Testler bunu doğrular (yalnız `'self'` ve tam hash'ler).
- Görseller mevcut `img-src 'self' data: https:` ile yüklenir; fontlar `font-src 'self'`.
- `lib/legal-render.ts` içindeki (CSP'nin zaten engellediği) Google Fonts bağlantısı ve silinen `phase1.css` bağlantısı kaldırıldı.

## Screenshots

`docs/quality/package-1c-screenshots/`:

| Dosya | İçerik |
|---|---|
| 01-home-desktop-1440 | Ana sayfa, tam sayfa |
| 02-home-mobile-390 | Ana sayfa mobil, tam sayfa |
| 03-catalog-desktop-1440 | Katalog, tam sayfa |
| 04-catalog-mobile-390 | Katalog mobil, tam sayfa |
| 05-product-desktop-1440 | Ürün detayı (Airy 12000), tam sayfa |
| 06-product-mobile-390 | Ürün detayı mobil, tam sayfa |
| 07–13 | 1280 / 1024 / 430 / 375 ilk ekranlar |
| 14 | Mega menü (klavye odağı) |
| 15 | Mobil menü |
| 16 | Mobil filtre paneli |
| 17 | Aktif filtreler (Airy · 12.000 BTU · stokta) |

Gree.com.tr karşılaştırması (masaüstü): Gree'nin güçlü yanı yaşam alanı fotoğraflı kampanya banner'ları ve kartta enerji etiketi/ürün bilgi formu ikonları. Ege Teknik tarafında hero kompozisyonu, seri keşfi (hesaplanan kapasite/fiyat/enerji), BTU'ya göre keşif, filtre derinliği (Gree: seri + kapasite + stok), aktif filtre yönetimi, karşılaştırma, kart bilgi yoğunluğu, ürün detayında bölüm menüsü/doğrulanmış özellik özetleri ve montaj/servis güveni Gree seviyesinde veya üzerinde. Temsili yaşam alanı görseli brief gereği kullanılmadı.

## Test

| Kontrol | Sonuç |
|---|---|
| Lint | PASS |
| Typecheck | PASS |
| Storefront testleri | PASS — yeni `tests/storefront-design-quality.test.ts` (9 test) dahil |
| Tam test paketi (sandbox) | 898 testten yalnız sandbox ortamına bağlı, bu değişiklikten önce de aynı şekilde kalan analytics saat dilimi ve migrator/pg dosyası başarısız; değişiklikten kaynaklı başarısız test yok |
| Build | PASS — `LOCAL_BUILD_NO_UPLOAD=1 next build`. Sandbox Google Fonts'a erişemediği için **yalnız admin** `next/font/google` isteği test amaçlı `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` ile karşılandı; storefront'un Google bağımlılığı yok |

Eski Tailwind ana sayfasına/eski header markup'ına sabitlenmiş testler, aynı niyeti (fiyat otoritesi, 44px hedefler, menü erişilebilirliği, alt metin, erişilebilir WhatsApp yeşili, okunur yazı boyutu, CSP) yeni işaretleme üzerinden doğrulayacak şekilde güncellendi.

## Remaining blockers

1. **Ürün görselleri ve teknik alanlar canlı veritabanında yok.** `egeteknik.tr/api/products` şu an zenginleştirme öncesi veriyi dönüyor (`imageUrl`, `energyClass`, `wifi` boş). Bu durumda katalog/ürün kartları "Ürün görseli henüz eklenmedi" durumuyla görünür (ana sayfa hero ve seri görselleri yerel olduğu için etkilenmez). Paket 1C kapsamı dışında olan zenginleştirme importu (78 onaylı kayıt) Preview'da çalıştırılıp doğrulanmadan ürün görsel kalitesi kapısı canlıda karşılanmaz.
2. **Preview doğrulaması yapılmadı.** Bu çalışma yerel; Preview'a deploy edilip aynı ekran/viewport seti gerçek DB ile tekrar alınmalı.
3. Sandbox'ta build için admin tarafındaki `next/font/google` bağımlılığı mock'landı; Vercel build ortamında sorun beklenmez ama admin fontunu da `next/font/local`'a almak ayrı, küçük bir iş olarak önerilir.

## Final verdict

`BLOCKED — storefront tasarımı yerel QA'da (onaylı zenginleştirme verisiyle) Gree seviyesini karşılıyor; ancak canlı/Preview veritabanında ürün görselleri ve enerji/Wi-Fi alanları henüz yok (zenginleştirme importu yapılmadı) ve Preview'da gerçek veriyle görsel doğrulama yapılmadı.`
