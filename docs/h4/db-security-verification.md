# H4-C — Veritabanı ve güvenlik doğrulaması (2026-10-22)

Hepsi **bu görevde yeniden çalıştırıldı**; geçmiş sonuçlar yeni PASS olarak sayılmadı.
Ortam: iki izole, tek kullanımlık PostgreSQL 18.6 kümesi (127.0.0.1, rastgele parola, scram, `sprintb*` veritabanları; iş sonunda silindi).
Production ve Preview veritabanlarına bağlanılmadı, yazılmadı. Tam günlükler: `docs/h4/evidence/` (parola/secret içermediği doğrulandı, gitleaks temiz).

| Kapı | Sonuç | Neyi kanıtlar |
|---|---|---|
| `verify:migrations` | PASS | 22 migration (0000–0021) ardışık; 0000–0012 dondurulmuş özetle birebir |
| `test:postgres` (gerçek PG) | **22/22** | head'e migration, eşzamanlı rezervasyon/iptal, durum CAS, finans korumaları (paid ← ödeme kaydı, iptal ← iade), audit hatasında rollback, kısıtlı rol ile checkout kilidi, değişmez kanıt |
| `test:legal-postgres` | **19/19** | hukuki sürüm eşleştirme, kabul kanıtı, değişmezlik |
| `test:acl-postgres` | **63/63** | bağımsız ACL ve değişmezlik kontrolleri (PUBLIC EXECUTE revoke, SECURITY INVOKER/DEFINER, search_path) |
| `test:commerce-postgres` | **38/38** | ticaret/finans/servis talepleri gerçek PG |
| `test:http-checkout` | PASS | gerçek HTTP: önizleme, sipariş 201, kanıt, stok, tekrar oynatma, çakışma, jeton/fiyat/pazarlama/stok/eski-hukuk reddi, kapalı/açık kapsamlı kimlik |
| **H4: `test-h4-checkout-http.mjs`** | PASS | 12 geçersiz ürün/miktar → sıfır satır, stok değişmez; stok 3 iken **8 eşzamanlı sipariş → tam 3 oluştu, 5 reddedildi**, stok 0/3, fazla satış yok; **aynı anahtarla 6 eşzamanlı istek → 1 sipariş** |
| `backup-automation.test.mjs` | **21/21** | GCM şifreleme, yanlış anahtar/bozuk dosya reddi, iş akışı ve sahte Drive testleri (Drive ağı yok) |
| `verify-recovered-backup.mjs` | PASS | sentetik tam döngü: dump → AES-256-GCM → çöz → ayrı DB'ye restore; **44 tablo, 0 veri farkı, 0 şema/sahiplik/ACL/varsayılan-ACL farkı**; yanlış anahtar ve bozuk dosya düz metin üretmeden reddedildi |
| **H4: `test-h4-restore-roles.mjs`** (2 kez) | PASS | eksik rolle restore **atomik reddedildi (0 tablo/0 fonksiyon kaldı)**; roller varken 45 ilişki/12 fonksiyon/11 tetikleyici sahip, ACL, SECURITY DEFINER, varsayılan ACL ve satır sayısı kaynakla **aynı**; **OWNER korunur**; kanıt değişmezliği restore sonrası da sürer |

Önemli gözlem: kabul kanıtı tablosunda test amaçlı `DELETE` bile **sahip rolüyle reddedildi** (değişmezlik tetikleyicisi); testim bunu yakalayınca silme yerine fark tabanlı doğrulamaya geçirildi.

## Düzeltilen test sorunları (uygulama kodu değişmedi)
- `verify-recovered-backup.mjs` restore adımında parolayı ortamdan geçirmiyordu (parolasız küme varsayımı); parola yalnızca `PGPASSWORD` ortamıyla eklendi, komut satırına yazılmaz.
- Yeni `test-h4-restore-roles.mjs` oluşturduğu rolleri temizler; ardışık koşuda geçti.

## Yedekleme / PR durumu (salt okunur)
- **PR #3** (`ops/neon-backup-dr-2026-09-28` → `hotfix/admin-session-rotation`): **AÇIK**, 23 dosya. **PR #23** (`ops/production-backup-main-20261020` → `main`): **AÇIK**, 8 dosya.
- `main` dalında `.github/workflows` dizini **yok** (GitHub API 404): zamanlanmış günlük Production yedeği (`30 1 * * *`) varsayılan dalda **şu an çalışmaz**; yalnızca PR #23 merge edilirse etkin olur.
- Son Actions koşuları 2026-10-20 (2 PR koşusu + 1 manuel `workflow_dispatch`, hepsi success). Bunlar **tarihsel**; Production secret'ları gerektirdiğinden bu görevde yeniden çalıştırılmadı.
- PR #23'ün "gerçek şifreli Production yedeği ayrı PG'de restore edildi, 34 tablo" ve "Drive roundtrip" iddiaları bu görevde **yeniden doğrulanmadı**: BLOCKED (Production arşivi/anahtarı açılamaz).
- `ege-teknik-db-restore-test/production-*.dump` gibi yedek arşivlerine **dokunulmadı, açılmadı, taşınmadı**.

## Kapsam dışı / BLOCKED
- Production'a uygulanmış migration: betik 0000–0012'yi "Production'da uygulanmış" kabul eder; **0013–0021 henüz Production'da değil**. Uygulama bunlara bağımlıdır (kapsamlı checkout, değişmez kanıt 0015–0020). Production migration ayrı, onaylı bir adımdır (bu görevde yapılmadı).
- Production verisiyle restore tatbikatı ve geri yükleme süresi (RTO/RPO) ölçümü.
- Neon branch/ACL gerçek ortam doğrulaması (yalnızca disposable PG'de koşuldu).
