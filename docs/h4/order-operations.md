# H4-B — Sipariş operasyonu (2026-10-22)

Yöntem: kod incelemesi + bu görevde çalıştırılan testler. Admin arayüzü bu görevde **oturum açılarak denenmedi** (admin oturumu/veritabanı yok); davranışlar API/alan mantığı ve gerçek-PG testleriyle doğrulandı.
Yeni sözleşme testi: `tests/h4-order-operations.test.ts` (7/7). İlgili mevcut testler bu görevde yeniden koşuldu: 177 test, 170 geçti, 7 atlandı (veritabanı gerektirenler; gerçek PG'de `test:commerce-postgres` 38/38 ve `test:postgres` 22/22 ile koşuldu).

| # | Soru | Sonuç | Kanıt |
|---|---|---|---|
| 1 | Yeni sipariş admin panelinde görünüyor mu? | **EVET** | `GET /api/admin/orders` sayfalı, `created_at DESC`, durum filtresi (`lib/orders-db.ts`); gerçek-PG `orders-db.test.ts` (commerce 38/38). Ayrıca `overview` son 100 siparişle sınırlıdır; liste için sayfalı uç nokta kullanılır |
| 2 | Ödeme durumu doğru ayrılıyor mu? | **EVET** | Sipariş durumu ile `payment_status` ayrı alanlardır; `payment_status` **yalnızca ödeme defterinden türetilir** (`derivePaymentStatus`); hiçbir admin sipariş rotası doğrudan yazmaz (test). Yeni sipariş: `pending_payment` + `pending`, ödeme satırı yok (gerçek HTTP testi) |
| 3 | Ödenmemiş sipariş yanlışlıkla "ödendi" yapılabilir mi? | **HAYIR** | `pending_payment` yalnızca `paid` veya `cancelled`'a geçebilir; `paid` için defterde toplam tutarın tamamı gerekir (`PAYMENT_NOT_RECORDED`, 409); gerçek PG: `test:postgres` finans korumaları |
| 4 | Durum değişiklikleri yetki kontrolünden geçiyor mu? | **EVET** | Tüm yazma rotaları `orders:write`, okuma `admin:read`, yetkisiz 403 (UI gizlemeye güvenilmez); durum değişikliği `expectedStatus` ile compare-and-set (bayat ekran reddedilir) |
| 5 | Sipariş, stok ve fiyat kayıtları tutarlı mı? | **EVET (disposable PG)** | Sipariş kalemleri satış anı anlık görüntüsü; `net = satırlar − KDV`, `toplam = net + KDV + ücretler`; 4 siparişte tümü tutarlı; stok `on_hand`/`reserved` koşullu atomik güncelleme; 8 eşzamanlı sipariş / stok 3 → tam 3 sipariş, fazla satış yok (`test-h4-checkout-http.mjs`) |
| 6 | İptal/iade akışları iş kurallarıyla uyumlu mu? | **EVET** | Tahsilat varken iptal reddedilir (`REFUND_REQUIRED`); iptal stoğu tek sefer geri bırakır (20×2 eşzamanlı iptal testi, gerçek PG); `cancelled` terminal; iade tutarı tahsilatı aşamaz (`validateRefund`) |
| 7 | Admin işlem kayıtları tutuluyor mu? | **EVET** | Durum, ödeme, iade aynı transaction'da denetim kaydı yazar (audit hatasında tüm işlem geri alınır — gerçek PG testi #7); denetim kaydını okumak ayrı yetki (`audit:read`); hukuki yayın `LEGAL_VERSION_PUBLISHED` |
| 8 | Müşterinin sipariş takip ekranı çalışıyor mu? | **EVET (kod+birim)** | `POST /api/orders/lookup` (e-posta + sipariş no; GET yok; 10/15 dk hız sınırı), tam sipariş listesi vermez; birim/rota testleri geçti. Hosted gerçek siparişle denenmedi (sipariş oluşturulmadı) |
| 9 | Müşteri bildirimi gerçekten gönderiliyor mu? | **HAYIR — manuel** | Mailer (`lib/mail.ts`) yalnızca yönetici davet/sıfırlama akışlarında kullanılır; sipariş yolunda e-posta/SMS **yoktur** (test bunu sabitler). Checkout metni bunu açıkça söyler ("Otomatik e-posta veya SMS gönderilmez") |
| 10 | Yönetici siparişi gözden kaçırabilir mi? | **EVET — operasyonel risk** | Sipariş uyarısı/bildirimi yok; yeni siparişler yalnızca admin listesinde görünür. Ödeme sağlayıcısı olmadığı için **her** sipariş `pending_payment` kalır ve manuel takip gerekir |

## Operasyonel riskler ve öneriler (kod değişikliği YAPILMADI)
1. **Bildirim yok (R1):** onaysız e-posta/SMS sağlayıcısı eklenmedi. Yayın öncesi karar: (a) günlük/saatlik manuel kontrol prosedürü ve sorumlu, ya da (b) onaylı bir sağlayıcı. Prosedür önerisi: listeyi "Ödeme Bekleniyor" filtresiyle aç, her yeni siparişi müşteriye 1 iş günü içinde telefon/e-postayla ödeme yöntemi için arayan kişi ata.
2. **Görev ayrımı yok (R2):** `support_agent`, `operations_manager`, `admin`, `owner`, `super_admin` hepsi `orders:write` taşır; bu yetki **manuel ödeme kaydı, iade ve "ödendi" durumunu** da kapsar. Çift onay yok; tek koruma denetim kaydıdır. Önerilen politika kararı: ödeme/iade için ayrı izin (kod değişikliği ve rol matrisi onayı gerektirir).
3. **Sipariş sayacı yok (R3):** panelde "bekleyen sipariş sayısı" göstergesi yok; (1) ile birlikte ele alınmalı.
4. **Müşteri iptal/iade talebi:** müşteri tarafı self-servis iptal yok; talep telefon/e-posta ile gelir ve admin tarafından işlenir (`orders:write`). İşletme prosedürü gerekli.
5. **Sipariş sayfası kanıtı:** `rendered_body` kişisel veri içerir; saklama süresi tanımsız (bkz. hukuki G1).

Production koşulu: yukarıdakilerden R1 ve R2'nin işletme kararı **BLOCKED** (insan kararı).
