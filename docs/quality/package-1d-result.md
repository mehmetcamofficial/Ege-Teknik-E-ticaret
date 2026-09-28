# Paket 1D — Final UX Polish + Content Integrity + Zero Dead Links

28 Eylül 2026 · dal `quality/package-1` · temel: `be588c1`. Paket 1C tasarımı korundu; finance, PayTR, migration ve ödeme backend'ine dokunulmadı. DB yazımı ve deploy yok.

QA yöntemi 1C ile aynı: gerçek statik CSP başlığıyla servis edilen sayfalar, üretim projeksiyonlarıyla (`toCatalogListItem` / `toPublicProductDetail`) üretilen API, resmî GREE görsellerinin yerel kopyası, Chromium (Playwright) ekran görüntüleri.

## 1. Akıllı Klima Seçici

- Ana sayfaya "Alanınıza uygun klimayı bulun" bölümü geri geldi (kapasite keşfi bölümünün içinde, `#klima-secici`). `selector.html` korunuyor; iki sayfa da aynı `renderBtuSelector()` + `calculateBtu()` kodunu kullanıyor, ikinci bir hesaplama motoru yok.
- Alanlar: şehir (9 hizmet ili), mekân türü, m², kişi sayısı, güneş, yalıtım. Eskiden sonuca etkisi olmayan kişi sayısı artık mevcut formüle eklendi (2 kişinin üzerindeki her kişi için +500 BTU/h); şehir sonuca ve keşif bağlantısına taşınıyor.
- Sonuç: önerilen BTU veya iki sınıfa yakınsa aralık (ör. "18.000 – 24.000 BTU/h"), katalogdaki uygun model sayısıyla CTA, keşif CTA'sı.
- Tek duvar tipi cihazın kapasitesi aşılırsa sonuç artık sessizce 24.000'e sabitlenmiyor: "24.000 BTU/h üzeri" deniyor, ticari ve salon tipi ürünlere ve keşfe yönlendiriliyor.
- Ticari mekân, 60 m² üzeri, yoğun güneş ile zayıf yalıtımın birlikte olması ve sınır değerler için "Yerinde keşif önerilir" uyarısı gerekçesiyle gösteriliyor.

## 2. Harita / hizmet bölgeleri

- OpenStreetMap kaynaklı il sınırlarından üretilmiş hafif, satır içi SVG Ege haritası (yaklaşık 19 KB, harita kütüphanesi yok, CSP değişmedi). Dokuz hizmet ili vurgulu, Kuşadası merkez işaretli; lisans gereği "© OpenStreetMap katkıda bulunanlar (ODbL)" atfı var.
- Harita ana sayfada, İletişim sayfasında ve Hizmet Bölgeleri sayfasında. Haritada bir ile ya da klavyeyle erişilebilir il düğmesine tıklayınca hizmet bilgisi paneli açılıyor: merkez bilgisi, hizmetler, "Keşif talebi" (`contact.html?subject=kesif&city=…`) ve ilin kendi sayfası.
- Google Maps iframe'i eklenmedi (CSP `frame-src` açılmadı); yol tarifi için mevcut Google Haritalar bağlantısı kullanılıyor.

## 3. İletişim CTA

- E-posta `info@egeteknik.tr` (`mailto:`) üst çubukta, footer'da, iletişim sayfasında, yardım menüsünde, ana sayfa hero'sunda ("İletişim" yolu), güven bölümünde, CTA bandında ve ürün detayında birincil iletişim yolu. Telefon ve yol tarifi de her yerde var. WhatsApp ikincil hızlı iletişim olarak kalıyor (üst çubuk, yardım menüsü, ürün detayında "WhatsApp'tan Sor").
- Ana sayfadaki yüzen WhatsApp butonu kaldırıldı, yerine "Yardım" menüsü geldi.
- İletişim formu gerçek backend'e bağlı (`/api/service-requests`). Alanlar: ad, e-posta, telefon (isteğe bağlı), şehir/ilçe, konu, mesaj. Backend artık telefon veya e-postadan en az birini istiyor (`lib/service-request-schema.ts`).
- Başarı mesajı yalnız sunucu takip numarası döndürdükten sonra gösteriliyor; form artık WhatsApp'a otomatik yönlendirmiyor. Admin servis talepleri listesinde e-posta da görünüyor.

## 4. Chatbot yuvası

- Sağ altta erişilebilir "Yardım" düğmesi (`aria-expanded` / `aria-controls`, Escape ile kapanır, odak yönetimi var). Panelde yalnız gerçek iletişim seçenekleri: e-posta, telefon, iletişim formu, WhatsApp, yol tarifi.
- Gelecekteki asistan için `#ege-assistant-root[data-assistant-slot]` yuvası ve `window.EgeAssistant.mount(render)` bağlantı noktası hazır. "AI aktif" benzeri hiçbir iddia yok; bunu bir test doğruluyor. Mobilde yalnız ikon görünüyor, "Yardım" etiketi ekran okuyucuya açık.

## 5. Premium hover

- Yalnız `(hover:hover) and (pointer:fine)` cihazlarda: kart 3px yükseliyor, kontrollü gölge, vurgu rengine dönen kenarlık, görsel `translateY(-3px) scale(1.03)`, başlık rengi ve CTA geçişi; tümü 200 ms ease-out. Seri kartlarında da aynı dil.
- Mobil hover'a bağlı değil. `prefers-reduced-motion` ile tüm geçişler kapanıyor. Layout shift yok (yalnız transform kullanılıyor).

## 6–10. Ürün detayı sekmeleri ve içerik

- Sekme menüsü yalnız içeriği gerçekten olan bölümleri listeliyor: Özellikler, Açıklama, Teknik özellikler, Belgeler, Montaj/Teslimat, Yorumlar.
- Garanti ve teslimat bilgisi yoksa Montaj/Teslimat bölümü ve sekmesi hiç oluşmuyor. `product.html?id=…#belgeler` gibi doğrudan bağlantılar içerik yüklenince doğru bölüme kayıyor (önceden kaymıyordu).
- Açıklama: kısa açıklama (lead), uzun açıklama, veri varsa öne çıkan özellikler. Tek ünite klimalarda kapasiteye göre tipik kullanım gösteriliyor; Multi Sistem ve Yedek Parça'da bu gösterilmiyor. Uydurma metin yok.
- Belgeler yalnız API'nin döndürdüğü gerçek bağlantılarla oluşuyor. Veri setindeki 41 belge URL'sinin tamamı (39 tlcklima.com, 2 gree.com.tr) kullanıcının Chrome'undan kontrol edildi: hepsi 200/206 döndü, 404 yok.
- Montaj ve teslimat metinleri yalnız ürünün `deliveryClass` alanından ve operatörün onayladığı metinlerden geliyor. Teklif ürünlerinde "montaj dahil" iddiası yok.
- Yorumlar: gerçek yorum yoksa "Bu ürün için henüz müşteri yorumu bulunmuyor." ve gerçek yorum formu. Yıldız ve sayı gösterilmiyor; 78 üründe sahte yıldız yok.
- Ürün detayındaki destek paneli: "İletişim / Teklif" + "E-posta gönder" (ürün adıyla hazır konu satırı).

## 11 ve 18. Link ve network denetimi

- Otomatik tarayıcı taraması (`qa/crawl.mjs`), 100 sayfa: ana sayfa, katalog, 78 ürün detayı, 9 bölge sayfası, rehber, iletişim, seçici, servis, spot, favoriler, karşılaştırma, sepet, yasal.
  - Boş, `#` veya `javascript:` href: **0**.
  - Hedefi olmayan anchor: **0**.
  - Boş section: **0**.
  - Metinde `undefined` / `null` / `NaN` / `[object`: **0**.
  - Kırık görsel: **0**.
  - Dahili 404: **0**.
- `/account` Next.js/Clerk rotası olduğu için QA sunucusunda yok; üretimde oturum açma sayfasına yönlendirdiği doğrulandı.
- Boş sepette "₺0" ara toplamı artık "—" olarak gösteriliyor.
- Harici bağlantılar (45): `mailto:`, `tel:`, `wa.me`, Google Haritalar paylaşım linki ve 41 belge. Belgelerin tamamı 200/206.
- CSS, JS, font ve yerel görsellerde 4xx/5xx yok. `/api/checkout/charges` 503'ü yalnız QA sunucusunun bilinçli yanıtı.

## 12. Footer

Deneyim şeridi ve uzun rehber/servis listeleri çıkarıldı. Kalanlar:

- Şirket
- İletişim: e-posta, telefon, yol tarifi, form
- 5 ana kategori + tüm ürünler
- Hizmetler: montaj/servis, keşif, hizmet bölgeleri
- Hesap: hesabım, sepet
- Yasal: satış/iade, KVKK, çerez tercihleri

## 13. Ürün detayı kalitesi

Tüm 78 görünür ürün tarandı: klimalar, salon tipi, ticari, multi iç/dış üniteler, ısı pompaları, fan/evaporatif (Home), filtreler (Yedek Parça).

- Kırık görsel 0, görselsiz ürün 0, sahte yıldız 0.
- 46 üründe belge, 45 üründe doğrulanmış teknik tablo var; olmayanlarda bölüm ve sekme gizli.
- Sekme dağılımı (en sık): 32 üründe tam set, 21 üründe Açıklama + Teslimat + Yorumlar.

## 16–17. Mobil ve erişilebilirlik

- 375 / 390 / 430 ve 1440 / 1280 / 1024 genişliklerinde harita, seçici, sekmeler, footer, iletişim ve yardım menüsü kontrol edildi: yatay taşma yok, konsol ve CSP hatası yok.
- axe-core WCAG 2.0 / 2.1 / 2.2 A–AA denetimi (ana sayfa, iletişim, hizmet bölgeleri, seçici, ürün, katalog; masaüstü ve mobil; yardım menüsü ve seçici sonucu açıkken): **0 ihlal**.
- Harita SVG'si `role="img"` + `title` / `desc` taşıyor, il seçimi klavyeyle erişilebilir düğmeler. E-posta ve telefon bağlantıları görünür metinli; dış bağlantılarda "yeni sekmede açılır" bilgisi var.

## 19. Ekran görüntüleri

`docs/quality/package-1d-screenshots/`: ana sayfa masaüstü ve mobil, akıllı seçici masaüstü ve mobil (sonuçla), hizmet bölgesi haritası masaüstü ve mobil, iletişim masaüstü ve mobil, katalog, katalog hover, ürün sekmeleri (`#belgeler`), ürün mobil, footer masaüstü ve mobil, yardım menüsü mobil.

## Test

| Kontrol | Sonuç |
|---|---|
| Lint | PASS |
| Typecheck | PASS |
| Yeni testler | 7 yeni test PASS: CSS blok dengesi, seçici aralık/keşif/üst sınır, telefon-veya-e-posta şeması, e-posta birincil iletişim, yardım yuvası (AI iddiası yok), 9 ilin haritası ve atıf, var olmayan bölüme sekme yok |
| Tam paket | 914 test; başarısız yalnız bu değişikliklerden önce de başarısız olan `analytics-sales` (saat dilimi) ve `migrator` (pg) dosyaları |
| Build | PASS (`LOCAL_BUILD_NO_UPLOAD=1`; sandbox Google Fonts'a erişemediği için yalnız admin fontu mock'landı) |

## Paket 1C'den devreden not

Paket 1D ölçütleri yerel QA'da karşılandı. Ancak 1C raporundaki veri engeli sürüyor: canlı veritabanında zenginleştirme importu yapılmadığı için canlıda ürün kartları "Ürün görseli henüz eklenmedi" durumunda. Bu durum boş/placeholder içerik kuralına uygun, nötr bir empty-state; ancak Preview'da import sonrası aynı ekran seti yeniden alınmalı. Servis talebi şemasındaki telefon/e-posta değişikliği de deploy sonrası Preview'da bir test talebiyle doğrulanmalı.

## Final verdict

`PASS — PAKET 1D UX & CONTENT INTEGRITY COMPLETE`
