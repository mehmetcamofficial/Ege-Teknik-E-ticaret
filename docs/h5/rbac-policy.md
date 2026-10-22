# H5-B — Rol ve ödeme yetkileri

Tam matris (koddan üretilmiş): `rbac-matrix.md`.

## Politika → uygulama
| # | Politika | Uygulama |
|---|---|---|
| 1 | Süper Yönetici tüm siparişleri yönetir | `super_admin`: `orders:write` + `payments:record` + `payments:refund` |
| 2 | Finans rolü açık izinlerle ödeme/iade yapar | yeni rol `finance_manager` = `payments:record`, `payments:refund`, `admin:read` |
| 3 | Operasyon rolleri yalnızca yetkili oldukları durumları değiştirir | `orders:write` yalnızca `paid` **dışındaki** geçişleri yapar |
| 4 | Normal personel "ödeme tahsil edildi" işaretleyemez | tahsilat kaydı ve `paid` geçişi `payments:record` ister |
| 5 | Normal personel iade kaydı oluşturamaz | iade `payments:refund` ister |
| 6 | Hiçbir rol defter kaydı olmadan "ödendi" yapamaz | `PAYMENT_NOT_RECORDED` (super_admin dahil); gerçek-PG testli |
| 7 | Hassas işlem kimlik, zaman, önceki/yeni durum, sonuçla denetlenir | işlem ile aynı transaction'da `audit_logs`; ret `permission_denied` olarak kaydedilir |

Kontrol **üç katmanda**: arayüz (yalnızca doğru kartlar/durumlar görünür), API rotası (kimlik doğrulama → izin; ret 403, aynı gövde, denetimli) ve
**servis** (`recordManualPayment`, `recordRefund`, `transitionOrder` etkin izin kümesini yeniden kontrol eder ve veritabanına dokunmadan reddeder).

## Davranış değişikliği (bilinçli sıkılaştırma)
Eskiden `orders:write` taşıyan her rol tahsilat, iade ve "ödendi" yapabiliyordu. Artık yalnızca `super_admin` ve `finance_manager` yapabilir.
**`admin`, `operations_manager`, `support_agent` ve emekli `owner` bu yetkilerini kaybeder.** Hiçbir kullanıcı otomatik yükseltilmez:
migration 0023 yalnızca üç CHECK listesini genişletir, kullanıcı/yetki/davet satırına dokunmaz (test).

## Finans yetkisi nasıl verilir (açık, denetimli süreç)
1. **Kalıcı:** süper yönetici kullanıcıyı `finance_manager` rolüyle davet eder (mevcut davet akışı; 72 saat; denetimli).
2. **Geçici:** süper yönetici (`roles:write`) mevcut süreli yetki ekranından `payments:record` / `payments:refund` verir: en fazla **24 saat**, gerekçeli, `grant` olarak denetlenir; her istekte sunucu saatine göre kontrol edilir.
3. `payments:configure` hâlâ verilemez. Rol yükseltme: yalnızca `roles:write`/`users:write` (yalnızca süper yönetici); finans rolü kendine yetki veremez (test).

## Dağıtım sırası (Production için ayrı onay)
Migration 0023 → uygulama → **önce** bir `finance_manager` davet edilmeli; aksi hâlde Production'da hiç kimse (süper yönetici hariç) tahsilat giremez.
