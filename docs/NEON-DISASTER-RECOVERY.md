# Ege Teknik — Neon Disaster Recovery Runbook

## Amaç
Production PostgreSQL verisini yanlış migration, yanlış SQL, branch arızası veya Neon erişim kaybı gibi durumlarda güvenli biçimde geri getirmek.

## Değişmez kurallar
- Production üzerinde körlemesine restore yapılmaz.
- Restore önce ayrı branch / ayrı database üzerinde doğrulanır.
- Sipariş, stok ve müşteri verilerinde olay anından sonra oluşmuş kayıtlar kontrol edilmeden cutover yapılmaz.
- Production DATABASE_URL hiçbir zaman repoya commit edilmez.
- Yedekler yalnızca şifreli halde saklanır.

## Otomatik yedek
Workflow: `.github/workflows/neon-production-backup.yml`

Her gün 01:30 UTC (Türkiye 04:30) çalışır.

Akış:
1. Production Neon bağlantısını GitHub secret'tan alır.
2. `pg_dump --format=custom` oluşturur.
3. `pg_restore --list` ile dump yapısını doğrular.
4. AES-256-CBC + PBKDF2 ile şifreler.
5. SHA-256 checksum üretir.
6. Şifrelenmiş dosyayı GitHub Actions artifact olarak 30 gün saklar.
7. R2 sırları tanımlıysa ayrıca Cloudflare R2'ye kopyalar.
8. Runner üzerindeki geçici dosyaları siler.

## Gerekli GitHub Secrets
Zorunlu:
- `NEON_PRODUCTION_DATABASE_URL_BACKUP`
- `BACKUP_ENCRYPTION_PASSWORD`

Cloudflare R2 için opsiyonel ama önerilen:
- `R2_ENDPOINT`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`

`BACKUP_ENCRYPTION_PASSWORD` uzun, benzersiz ve GitHub/Neon parolalarından farklı olmalıdır. Kaybolursa şifreli dump açılamaz; bu nedenle güvenli bir parola yöneticisinde ayrıca saklanmalıdır.

## Backup doğrulama testi
Ayda en az bir kez:
1. Son `.dump.enc` ve `.sha256` dosyasını indir.
2. `sha256sum -c <dosya>.sha256` ile bütünlüğü doğrula.
3. Şifreyi çöz:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in ege-teknik-production-....dump.enc \
  -out restore-test.dump \
  -pass env:BACKUP_ENCRYPTION_PASSWORD
```

4. İçeriği kontrol et:

```bash
pg_restore --list restore-test.dump >/dev/null
```

5. Production olmayan geçici PostgreSQL/Neon branch'ine restore et.
6. Kritik tabloları kontrol et: products, inventory/stocks, customers, orders, order_items, admins.
7. Test tamamlanınca geçici ortamı kaldır.

## Olay prosedürleri

### A — Yerel elektrik / internet kesintisi
Neon bulutta çalışmaya devam eder. Yerel bağlantı geri gelince uygulama yeniden bağlanır. Database restore gerekmez.

### B — Yanlış SQL / veri silinmesi
1. Yazma trafiğini mümkün olduğunca durdur.
2. Olay zamanını kaydet.
3. Neon point-in-time recovery / snapshot üzerinden olaydan hemen önceki durumu ayrı branch'e getir.
4. Kritik tablo sayımlarını ve son siparişleri karşılaştır.
5. Olaydan sonra oluşmuş doğru kayıtları belirle ve reconcile et.
6. Doğrulama sonrası kontrollü cutover yap.

### C — Hatalı migration
1. Yeni migration/deploy'u durdur.
2. Migration öncesi snapshot/checkpoint veya PITR branch'i oluştur.
3. Schema karşılaştırması yap.
4. Sipariş/stok/ürün smoke test uygula.
5. Doğrulanmış branch'e geç veya düzeltici migration uygula.

### D — Production branch kullanılamaz
1. Yeni restore branch'i oluştur.
2. Uygulama health check ve kritik sorguları çalıştır.
3. Connection string değişikliğini kontrollü yap.
4. Eski branch silinmez; olay kapatılana kadar korunur.

### E — Neon projesi/hesabı erişilemez
1. Son harici şifreli dump'ı GitHub Artifact veya R2'den al.
2. Checksum doğrula.
3. Şifreyi çöz.
4. Yeni PostgreSQL/Neon projesi oluştur.
5. Restore et.
6. Uygulama secrets/env değerlerini yeni database'e yönlendir.
7. `/api/health`, admin ve checkout salt-okunur smoke testlerini çalıştır.

## Restore komutu örneği
Hedef database boş ve güvenli bir test ortamı olmalıdır.

```bash
pg_restore \
  --dbname="$RESTORE_DATABASE_URL" \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  restore-test.dump
```

`--clean` hedefteki nesneleri silebildiği için Production URL ile kullanılmamalıdır.

## Deployment öncesi checklist
- Production sağlık kontrolü PASS
- Güncel harici backup mevcut
- Kritik migration öncesi Neon snapshot/checkpoint mevcut
- Migration Preview üzerinde test edildi
- Production migration sonrası schema doğrulandı
- Sipariş/stok/ürün smoke test PASS
- Backup workflow son çalışması PASS

## Hedefler
- Neon PITR kapsamındaki mantıksal hata: mümkün olan en düşük RPO
- Harici backup felaketi: günlük backup ile en fazla yaklaşık 24 saat RPO
- Kurtarma hedefi: mümkün olduğunda 1 saatten düşük RTO

Bu runbook her gerçek incident veya restore tatbikatından sonra güncellenmelidir.
