# H5-A/B — Sipariş bildirimleri ve yetki güvenliği: kabul kaydı (2026-10-22)

Branch `feature/hybrid-h5-order-operations` (H4 `eeab384` üzerinden). Uygulama kodu Preview'da: `148ba32` → `dpl_ENhLab5dKp3UR58tz1EU2MhcB4ok` (Ready, preview).
**Hiçbir veritabanına migration uygulanmadı. Gerçek e-posta/SMS gönderilmedi. Gerçek sipariş oluşturulmadı. Production NO-GO korunuyor.**

## Migration listesi (hiçbiri uygulanmadı)
| No | Dosya | İçerik |
|---|---|---|
| 0022 | `notification_outbox` | yeni tablo (alıcı/konu/gövde yok), dedupe CHECK + UNIQUE, durum/deneme CHECK'leri |
| 0023 | `finance_permissions` | üç CHECK listesini genişletir (rol `finance_manager`, izinler `payments:record/refund`); kullanıcı/yetki/davet satırına dokunmaz |

## Sonuçlar (hepsi bu görevde çalıştırıldı)
| Kapı | Sonuç |
|---|---|
| TypeScript, ESLint (0 hata, eski 5 uyarı), build, gitleaks | PASS |
| Birim testleri | **1642 geçti, 0 başarısız, 87 atlandı** (atlananlar gerçek-PG gerektirir) |
| `verify:migrations` | PASS |
| Disposable PG 18.6: `postgres` 22/22, `legal` 19/19, **ACL 63/63** (yeni tablo dahil), **`commerce` 48/48** (10 yeni gerçek-PG RBAC testi), HTTP checkout | PASS |
| H4 gerçek HTTP (12 geçersiz girdi · 8 eşzamanlı sipariş→3 · 6 aynı anahtar→1) | PASS |
| **H5-A gerçek HTTP + loopback sahte sağlayıcı:** outbox hatası siparişi engellemez · worker 404/401/200 · süpürme (30 dk) · satır başına 2 bildirim, replay eklemez · içerik/kaçış/idempotency anahtarı/maskeli denetim · 503→backoff→2. denemede gönderildi · 422→dead→requeue (denetimli) · 6 eşzamanlı işçi→1 gönderim · çöken işçi kilidi kurtarılır · tavandaki takılı satır dead | PASS |
| **H5-B gerçek PG:** yetkisiz tahsilat/iade/durum reddi (hiçbir satır yazılmaz) · süper yönetici dahil kimse defter olmadan `paid` yapamaz · finans `preparing` yapamaz · aynı Idempotency-Key tek ödeme · eşzamanlı ödemeler fazla tahsil etmez, eşzamanlı geçişte tek kazanan · denetim hatasında ödeme geri alınır | PASS |
| Yedek: birim 21/21 · sentetik yedek→restore **45 tablo, 0 fark** · eksik rolle restore atomik reddedildi, roller varken OWNER/ACL/SECURITY DEFINER birebir (46 ilişki) | PASS |
| **Hosted Preview:** H3.1, H3, H2/H2.1, H1.2 (Chrome/Firefox/WebKit × 320/390/768/1024/1440), 324 axe, hata yok | PASS 15/15 × 4 |
| Hosted salt-okunur kapılar 11/11 (ortam ayrımı, anonim yönetici reddi, başlıklar, worker rotası secret'sız 404, özet/requeue anonim 403, dürüst checkout metni) | PASS |
| Oturumlu yönetici tarayıcı testi (yeni sayaç/bildirim kartı, finans rolü ekranları; klavye/erişilebilirlik) | **BLOCKED** — admin oturumu yok; kart mantığı birim testli, görsel/axe doğrulaması yok |
| Gerçek e-posta gönderimi | **BLOCKED** — Production/Preview'da sağlayıcı anahtarı yok; yalnızca loopback sahte sağlayıcı |

## Production için kalan engeller (NO-GO korunur)
1. Hâlâ H4'teki engeller: gerçek hukuki belgeler/ETBİS/KEP, **`LEGAL_PREVIEW_SIGNING_SECRET` Production'da yok**, migration 0013–0021 uygulanmadı, zamanlanmış yedek yok.
2. **Yeni:** migration **0022 ve 0023** uygulanmalı; 0023'ten sonra **önce bir `finance_manager` davet edilmeli** (yoksa süper yönetici dışında kimse tahsilat giremez).
3. **E-posta:** `RESEND_API_KEY`, `MAIL_FROM`, `ORDER_ALERT_EMAILS`, `NOTIFICATION_DISPATCH_SECRET`, `SITE_ORIGIN`, `ADMIN_ORIGIN` Production'da tanımlı değil; alan adı doğrulaması (SPF/DKIM) ve işçi zamanlayıcısı (cron) yok; KVKK metninde e-posta işleyicisi hukuk incelemesi bekliyor.
4. Kapsamlı checkout kullanılacaksa operatör SQL'i (`docs/ops/notification-outbox-grants-20261022.sql`); yoksa bildirimler süpürme ile (≤30 dk) tamamlanır.
5. Rol politikası değişikliği (admin/operasyon/destek artık ödeme kaydedemez) işletme onayı bekliyor.
