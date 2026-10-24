# H5-A — Sipariş bildirimleri

**Durum: kod hazır, hiçbir ortamda etkin değil.** Migration 0022 hiçbir veritabanına uygulanmadı; gerçek e-posta gönderilmedi
(testler yalnızca loopback sahte sağlayıcı kullandı). Production'da e-posta sağlayıcısı yapılandırılmamıştır → **gönderim BLOCKED**.

## Akış
1. Müşteri siparişi onaylar → `POST /api/orders` siparişi, kalemleri, kabul kanıtlarını **ve** iki outbox satırını
   (`order_customer_received`, `order_admin_new`) aynı transaction'da yazar. Outbox yazımı **SAVEPOINT** içindedir:
   tablo/yetki yoksa yalnızca savepoint geri alınır, **sipariş kaydedilir**. Transaction içinde e-posta gönderilmez.
2. Commit sonrası bir **işçi** (`GET /api/internal/notifications/dispatch`, `Authorization: Bearer $NOTIFICATION_DISPATCH_SECRET`)
   vadesi gelen satırları `FOR UPDATE SKIP LOCKED` ile talep eder, siparişi yeniden okuyup e-postayı üretir ve sağlayıcıya gönderir.
3. Sonuç: `sent` · `pending` (1 dk, 5 dk, 30 dk, 2 sa sonra yeniden) · `dead` (kalıcı hata veya 5 deneme). Her sonuç denetim kaydı yazar
   (alıcı **maskeli**: `a***@e***.com`).

## Güvence özellikleri (testle doğrulandı)
| Özellik | Kanıt |
|---|---|
| Sipariş, e-posta servisinin veya outbox'ın başarısına bağlı değil | outbox yetkisiz rolle sipariş 201 |
| Mükerrer bildirim yok | `dedupe_key = order:<id>:<kind>` (CHECK + UNIQUE); replay yeni satır eklemez; sağlayıcıya idempotency anahtarı olarak gider; 6 eşzamanlı işçi → 1 gönderim |
| Kontrollü tekrar | 503 → backoff → 2. denemede gönderildi; vadesi gelmeden tekrar denenmez |
| Kalıcı hata | 422 → `dead`; otomatik tekrar yok; yönetici `POST /api/admin/notifications/:id/requeue` ile (denetimli) geri alabilir |
| Çöken işçi | kilidi süresi dolan satır yeniden talep edilir; deneme tavanındaki takılı satır `dead` olur, tekrar gönderilmez |
| Kaçan bildirim | 30 dk içindeki sipariş için eksik outbox satırı süpürme ile tamamlanır; eski siparişlere asla geriye dönük e-posta gitmez |
| Servis kapalıyken | satırlar bekler, deneme harcanmaz; yönetici ekranı "E-posta bildirimleri devre dışı — müşteriye otomatik e-posta GİTMİYOR" der |
| HTML kaçışı / başlık enjeksiyonu | şablon testleri (`tests/h5-notifications.test.ts`) |
| Loglarda kişisel veri yok | kaynak ve denetim testleri; denetim satırları yalnızca maskeli adres |

## İçerik doğruluğu
Müşteri e-postası: sipariş numarası, ürünler ve adetleri, **sunucuda doğrulanmış** tutar, **"Ödeme durumu: Tahsil edilmedi"**, teslimat özeti,
takip bağlantısı (mevcut model: sipariş no + e-posta; adres URL'ye konmaz), iletişim bilgileri. Ödeme alındığı, kargolandığı veya montaj
randevusu verildiği **söylenmez**; kesin tarih verilmediği yazılır. Yönetici e-postası: sipariş no, toplam, zaman, ödeme durumu, detay bağlantısı; müşteri verisi yok.

Checkout metni artık "e-posta gönderilmeyecek" demez; "e-posta hizmeti kullanılabilir olduğunda gönderilmeye çalışılır ve ulaşması garanti edilmez; SMS gönderilmez" der.

## Yönetici ekranı
`/admin/orders` üstünde: **Ödeme bekleyen sipariş**, **Son 24 saatte yeni sipariş** ve **Bildirimler** kartı (çalışıyor / bekleyen / başarısız / devre dışı + neden).
Veri: `GET /api/admin/orders/summary` (admin:read; yalnızca sayılar). Oturumlu tarayıcı testi bu görevde yapılamadı (admin oturumu yok): **BLOCKED**.

## Etkinleştirme (ayrı, onaylı bir görev; bu görevde yapılmadı)
1. Migration **0022** uygula (önce yedek). 2. Kapsamlı checkout kullanılıyorsa `docs/ops/notification-outbox-grants-20261022.sql`.
3. Ortam değişkenleri (adlar): `RESEND_API_KEY`, `MAIL_FROM`, `ORDER_ALERT_EMAILS` (virgüllü; **zorunlu**, `admin_users` yedeği yoktur — PR #37),
   `NOTIFICATION_DISPATCH_SECRET` (≥32 karakter), `NOTIFICATION_WORKER_DATABASE_URL` (`docs/ops/notification-worker-grants-20261024.sql` ile oluşturulan ayrı rol), isteğe bağlı `NOTIFICATION_SWEEP_WINDOW_MINUTES` + `NOTIFICATION_SWEEP_NOT_BEFORE` (uzun kesinti kurtarma; yalnızca ikisi birlikte ve geçerliyse), `SITE_ORIGIN`, `ADMIN_ORIGIN`. 4. İşçiyi zamanlayın (ör. Vercel Cron, her dakika; `vercel.json` bu görevde **eklenmedi**).
5. Gönderici alan adı doğrulaması (SPF/DKIM) ve KVKK metninde e-posta işleyicisi (Resend) — **hukuk incelemesi**.

## Açık noktalar
- Gerçek sağlayıcı ve zamanlayıcı yok (BLOCKED). Teslim-sonrası "bounce/şikayet" geri bildirimi (webhook) yok.
- Sağlayıcı idempotency anahtarı 24 saat geçerlidir; bir satır 24 saatten sonra yeniden denenirse nadiren çift e-posta oluşabilir.
- Müşteri onay/ret tercihi: işlemsel (sipariş) e-postadır, pazarlama değildir; hukuki dayanak hukuk incelemesi gerektirir.
