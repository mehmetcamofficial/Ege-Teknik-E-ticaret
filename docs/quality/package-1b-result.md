# Paket 1B sonuç — BLOCKED

28 Eylül 2026, `quality/package-1` dalı. Bu çalışma yerel checkout üzerindedir; Preview veya Production ortamına dağıtım, DB yazımı/migration, gerçek sipariş ya da ödeme bağlantısı yapılmadı.

## Tamamlanan yerel değişiklikler

- Ana sayfanın üç vitrini katalogdaki `productCard` çıktısını kullanıyor. Katalog yüklendiğinde eski statik kartın içeriği silinip API fiyatı, görseli, adı, stok ve aynı favori/karşılaştır/sepete ekle aksiyonları gösteriliyor. Katalog dışı üründe "Şu anda listelenmiyor", API hatasında açıklayıcı durum gösteriliyor. Hero mevcut katalog bağını koruyor.
- İnceleme veri setinde `BLOCKED_` olan dokuz ürün, müşteri ürün listesinde ve ürün detayında gösterilmiyor; bu kimliklerle yeni sipariş isteği sunucuda reddediliyor. İdempotent eski sipariş tekrarının cevabı korunuyor. Veri tabanındaki ürün kaydı, envanter ve ticari alanlar değiştirilmedi. Bu kodun canlı DB'ye karşı davranışı Preview'da ayrıca doğrulanmalıdır.
- 35 `READY_WITH_LIMITED_SPECS` kaydının hepsinde SKU, birincil görsel, galeri, kısa/uzun açıklama ve kaynak URL dolu. Teknik özellik ve belge alanları her ürün için tam değildir; eksik doğrulanmamış alanı uydurmadık.

## Engelli ürün envanteri

| Ürün ID | İnceleme | Neden / güvenli davranış |
|---|---|---|
| `gree-aphro-a-18-000-btu-duvar-tipi-inverter-klima-montaj-dahil-31` | `BLOCKED_ASSET` | GWH18ALD-K6DNA2A: resmî birincil görsel promosyonlu; temiz alternatifler 800 px altında. Gizli. |
| `gree-aphro-a-24-000-btu-duvar-tipi-inverter-klima-montaj-dahil-25` | `BLOCKED_ASSET` | GWH24ALD-K6DNA2B: aynı görsel engeli. Gizli. |
| `gree-fairy-a-12-000-btu-duvar-tipi-inverter-klima-siyah-18` | `BLOCKED_ASSET` | GWH12ACC-K6DNA1F-B: promosyonlu birincil/ düşük çözünürlüklü temiz görsel. Gizli. |
| `gree-fairy-a-18-000-btu-duvar-tipi-inverter-klima-siyah-montaj-dahil-16` | `BLOCKED_ASSET` | GWH18ACD-K6DNA1I-B: aynı görsel engeli. Gizli. |
| `gree-fairy-a-24-000-btu-duvar-tipi-inverter-klima-siyah-montaj-dahil-15` | `BLOCKED_ASSET` | GWH24ACE-K6DNA1I-B: aynı görsel engeli. Gizli. |
| `gree-fairy-a-9-000-btu-duvar-tipi-inverter-klima-siyah-montaj-dahil-29` | `BLOCKED_ASSET` | GWH09ACC-K6DNA1F-B: aynı görsel engeli. Gizli. |
| `wifi-kiti-aphro-18000-24000-72` | `BLOCKED_ASSET` | SKU 000157060196, mevcut baz ürün adı 9000–12000; uygun yüksek çözünürlüklü resmî görsel yok. Gizli; ID metni ürün adı yerine kanıt sayılmadı. |
| `wifi-kiti-aphro-64-1` | `BLOCKED_ASSET` | SKU 000409000001, 18000–24000; resmî görseller 800 px altında. Gizli. |
| `multi-duvar-tipi-pular-ic-unite-9000-btu-h` | `BLOCKED_CONFLICT` | Resmî sayfadaki ürün başlığı ile 9000 BTU/h verisi çelişiyor; TLC teyidi gerekiyor. Gizli. |

Eski yanıltıcı slug'lı Amber iç ünite (`multi-duvar-tipi-amber-ic-unite-24000-btu-h`) bloklu sayılmadı: baz ürün, SKU ve kaynak 9000 BTU/h gösteriyor; mevcut slug redirect kaydı bu ayrımı tutuyor.

## Doğrulama

| Kontrol | Sonuç |
|---|---|
| Yerel lint ve TypeScript | PASS |
| Test paketi | 947/947 PASS; vitrinin ortak kartı ve dokuz ürüne ait koruma için yeni testler dahil |
| Üretim derlemesi | PASS, `LOCAL_BUILD_NO_UPLOAD=1 NEXT_TELEMETRY_DISABLED=1 pnpm build`; kaynak HTML derleme sonrası geri yüklendi |
| Preview `/api/health` | BLOCKED: Cloud Browser `net::ERR_BLOCKED_BY_CLIENT`; mevcut Preview'ın health JSON'u bu turda okunamadı |
| Preview tüm kategoriler, 5 kart, 3 detay, desktop/mobile, gerçek görsel ve link kontrolü | TEST EDİLEMEDİ; health kapısından sonra ilerlenmedi |
| Canlı DB'de 78 zenginleştirme ve dokuz ürünün kapatılması | TEST EDİLEMEDİ; DB bağlantısı/değişikliği yapılmadı |
| Gerçek yasal metinler ve sipariş akışı | BLOCKED: Preview test yasal fixture'ı yerine doğrulanmış metinler gerekli; gerçek sipariş oluşturulmadı |

## CSP

Önceki ekran görüntülerinde kaynak ve `eval` engeli gözlenmişti. Exact directive, blocked URL, çağıran script ve stack görüntüden okunamıyor. Bu turda Preview Console/Network'e erişilemedi; kök nedeni doğrulanmadı, CSP gevşetilmedi ve `unsafe-eval` eklenmedi. Kod incelemesi, etkin politikanın `proxy.ts` ve `next.config.ts` üzerinden üretildiğini gösterir; bu gözlem hatanın kaynağını kanıtlamaz.

## Karar

**BLOCKED.** Yerel kalite kapıları geçiyor ve dokuz sorunlu ürün için müşteri API koruması kodlandı. Preview health/desktop/mobil/sayfa/asset testi, canlı veri durumu, CSP kök nedeni ve yasal içerik doğrulanmadığı için Paket 1B veya site yayına hazır olarak onaylanamaz. Sonraki doğrulama, erişilebilir Preview oturumunda health ile başlayıp tüm kategoriler, beş kart, üç detay, Network/Console ve ekran boyutları üzerinden yapılmalıdır.
