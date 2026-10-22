# Ege Teknik — Backup ve felaket kurtarma

> **DURUM (kullanımdan kaldırıldı — Production için):** Production yedeği artık `.github/workflows/production-db-backup.yml` ile alınır (GitHub OIDC → Workload Identity → özel Google Drive; GitHub artifact yok). Bu belgedeki eski akışın zamanlaması ve GitHub artifact adımı kaldırıldı; repo herkese açık olduğu için şifreli dump bile artifact olarak yayımlanmaz. Eski iş yalnızca ayrı `LEGACY_NEON_BACKUP_ENABLED` anahtarı ve manuel çalıştırmayla açılabilir; bu anahtar tanımsız kalmalıdır. Aşağıdaki artifact/zamanlama anlatımı tarihsel kayıttır.

Bu yerel PR #3 adayı otomatik backup ve ayrı boş hedefte kurtarma içindir. Production'a restore/cutover, migration, merge ve deploy ayrı açık onay gerektirir. Mevcut veritabanlarını veya yedekleri silmeyin. Yeni abonelik gerekmez; mevcut runner/Drive kotaları ve retention ayrıca izlenmelidir.

## Otomatik iş akışı

`.github/workflows/neon-production-backup.yml`: her gün01:30UTC /04:30 Türkiye; manuel workflow_dispatch de var. PR değişikliklerinde sadece secret'sız tests job'u çalışır; backup job'u `pull_request` olayında açıkça atlanır. Takvim konfigürasyonu job'un gerçekten çalıştığını garanti etmez; son başarılı tamamlanma zamanı izlenmelidir. Concurrency aynı anda iki backup çalıştırmaz.

1. Secret'sız test job'u GCM, CBC uyumluluğu, mock Drive ve gerçek shell üretici kontrollerini çalıştırır.
2. Backup job'u repo kodunu checkout eder; Node24, PGDG PostgreSQL18 client ve rclone kurar. pg_dump/pg_restore major18 dışında durur.
3. `scripts/backup-dump.mjs` doğrudan PostgreSQL URI'sini ayrı libpq ortam alanlarına ayırır; URL/parola subprocess argümanlarına veya loga yazılmaz. Desteklenmeyen URI seçeneği sessizce atlanmaz; job durur. Neon için doğrudan bağlantı, örneğin sslmode=require/channel_binding=require koşulları korunur. Pooled bağlantı tercih etmeyin.
4. Custom full dump owner, GRANT/REVOKE, default privilege ve fonksiyon izinlerini korur; `--no-owner` / `--no-privileges` kullanılmaz. Dump reader'ın kapsamı tüm gerekli tablolar, sequence ve metaveriyi okuyabilmelidir; role bu görevde production üzerinde yeni yetki verilmedi.
5. `pg_restore --list`; ETGCM002 AES-256-GCM şifreleme; yerel auth/decrypt, byte eşitliği ve tekrar archive-list kontrolü geçmeden kopya yayınlanmaz.
6. Şifreli dump + SHA256 + public key-version metadata'sı GitHub artifact olarak30gün tutulur. Plain dump ve kontrol çıktısı EXIT trap ile temizlenir.
7. Zorunlu Drive adımı yalnız info@egeteknik.tr hesabını ve açık folder ID'sini doğrular. Private temp rclone config OAuth refresh için kullanılır; asıl config değiştirilmez. Yanlış hesap, herkese açık/trashed/yazılamayan klasör, eksik izin metadata'sı veya yapılandırma fail-closed olur. Klasör adıyla yeni klasör oluşturmaz, sync/delete/link/share çalıştırmaz.
8. Drive'a yalnız ETGCM002 ciphertext, checksum ve whitelist edilmiş public metadata upload edilir; üç dosya tekrar indirilip SHA256 karşılaştırılır. Mevcut dosya değiştirilmez (`--immutable`). Transport GCM key veya DB URL almaz. Bu downloaded byte-equality, producer'ın doğrulanmış ciphertext'ini korur; gerçek restore tatbikatının yerine geçmez.
9. R2 tüm secret'lar yoksa devre dışı, kısmi config varsa hata; yapılandırılmışsa aynı3 dosyayı kopyalar. R2 bağımsız download/restore kabulü ayrıca yapılmalıdır.
10. Her zaman yalnız bu işin temp klasörleri temizlenir. Test/backup başarısız veya backup iptal edilirse ayrı failure job'u error annotation/summary üretir. GitHub workflow failure aboneliği hesap sahibi tarafından açılıp test edilmelidir; e-posta/Slack teslimi bu kod tarafından garanti edilmez.

## Anahtarlar ve konfigürasyon

**GitHub Secrets:**

- `NEON_PRODUCTION_DATABASE_URL_BACKUP`: yalnız gereken okuma yetkili doğrudan bağlantı; owner/ACL'yi dump'tan çıkarmak için gerekçe değildir.
- `BACKUP_GCM_KEY_B64`: kriptografik rastgele32byte anahtarın standart canonical base64 karşılığı. Parola değildir. Güvenli secret yönetim aracında oluşturun; terminale/loga echo etmeyin.
- `EGE_GDRIVE_RCLONE_CONFIG_B64`: dedicated `ege_teknik_backup` remote config'inin base64'ü. **Base64 şifreleme değildir**; refresh token/client secret içerir ve credential gibi korunmalıdır. Google hesabı info@egeteknik.tr olmalı, uygun OAuth scope ve kurumca izinli client kullanılmalı. `rclone config dump/show` çıktısını loglamayın.

**GitHub Variables (secret olmayan):**

- `BACKUP_GCM_KEY_ID`:1–64 ASCII harf/rakam/altçizgi/tire; örneğin kurumun key version kimliği. Key'in kendisi veya türevi değildir.
- `EGE_GDRIVE_FOLDER_ID`: bu tur salt okunur doğrulanan mevcut Automated klasör ID'si `1dVSxt7a2yyovyGZnEmAUzY89gyRSJBPq` (eski156boYt-CsTxXm0uoxBtPmrKyYyuFrz8G bu hesapta404 verdi); değer otomatik değiştirilmez. Önceden hazırlanmış private backup klasörünün gerçek ID'si. İstenen hesabın canAddChildren yetkisi doğrulanmalıdır. Klasör ID'sine köklenmek OAuth credential'ını sağlayıcı tarafında folder-scoped yapmaz; OAuth izinleri ve hesap erişimi ayrıca en aza indirilmelidir.

**Yalnız eski CBC restore için:** `BACKUP_ENCRYPTION_PASSWORD`. Yeni workflow bu secret'ı kullanmaz; eski arşivler tutulduğu sürece özgün parola güvenli kasada tutulmalıdır.

**Opsiyonel R2 Secrets:** `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Bu değişiklik hiçbir secret oluşturmaz veya güncellemez.

### Rotation ve anahtar kurtarma

- Key ID → anahtar eşlemesini Drive/GitHub hesabından bağımsız erişim kontrollü kasada tutun; en az bir yetkili yedek sorumlu ve kurtarma yolu bulunsun. Key'i backup klasörüne, metadata'ya, issue/PR/rapora koymayın.
- Yeni key ve yeni ID birlikte atomik rollout edilmelidir. Key-ID metadata'sı sadece seçim yardımcısıdır; güvenilir envanterle eşleştirin. GCM authentication yanlış key'i reddeder.
- Eski key/CBC parolasını retention süresi ve son ilgili kopya/restore doğrulanana kadar silmeyin. Eski backup'ları yerinde yeniden şifrelemeyin/üzerine yazmayın; gerekiyorsa ayrıca incelenmiş yeni kopya üretin.
- Kaybolan key ile GCM backup kurtarılamaz. Bu görev production key rotation veya kasa entegrasyonu yapmaz. İşletime almadan kasa key recovery tatbikatı gerekir.

## Arşiv biçimleri

**ETGCM002:**8byte ASCII magic +12byte random nonce +ciphertext +16byte tag. Magic+nonce (20byte header) GCM AAD'dir.256bit key,128bit auth tag. Yeni backup'lar sadece bu biçimdedir. Script streaming çalışır; authentication başarılı olmadan plaintext nihai output adıyla yayınlanmaz.0600 temp/plain dosya auth hatasında kaldırılır; var olan output asla overwrite edilmez. Hardlink ile atomik publish aynı dizinde yapılır; hardlink desteklemeyen dosya sisteminde işlem durur. SIGKILL/elektrik kesintisinde0600 partial kalabilir; erişim kontrollü çalışma klasörü ve runner cleanup önemlidir.

**Legacy CBC:**OpenSSL `Salted__` başlığı, AES256CBC/PBKDF2/200000, özgün BACKUP_ENCRYPTION_PASSWORD. CBC authenticated değildir: SHA256 güvenilir bağımsız kaynaktan gelmelidir; saldırganın ciphertext ve checksum'u birlikte değiştirmesine karşı güvence sağlamaz. Yanlış parolanın padding kontrolünü nadiren geçmesi mümkündür; archive-list/veri/ACL kontrolü zorunludur. ETGCM001 veya tanınmayan formatlar otomatik kabul edilmez. Bozuk GCM hiçbir durumda CBC fallback'a dönüştürülmez.

## Kurtarma — indirme ve decrypt

Yalnız yeni, erişim kontrollü yerel çalışma dizininde `umask 077` kullanın. Arşiv/checksum/key-id metadata'sını kaynaktan alın, tamamını saklayın. Archive basename ve checksum'un beklenen kayda ait olduğunu doğrulayın. SHA256 yalnız kazara bozulmayı kontrol eder; GCM tag anahtar sahipliğiyle authenticated doğrulamayı sağlar.

Güvenli kasadan gerekli key'i **loglamadan** yerel ortam değişkenine sağlayın. Shell tracing kapalı olsun. Key değerini komut satırına yazmayın. `$TRUSTED_SHA256` yalnız hex digest'tir:

```bash
node scripts/backup-decrypt.mjs "$ARCHIVE" "$NEW_DUMP" "$TRUSTED_SHA256"
pg_restore --list "$NEW_DUMP" > /dev/null
```

Eski Salted__ CBC için özgün parolayı loglamadan BACKUP_ENCRYPTION_PASSWORD ortamında sağlayın ve açık opt-in kullanın:

```bash
node scripts/backup-decrypt.mjs "$LEGACY_ARCHIVE" "$NEW_DUMP" "$TRUSTED_SHA256" --allow-legacy-cbc
pg_restore --list "$NEW_DUMP" > /dev/null
```

Yanlış hash/key, desteklenmeyen format veya var olan output hata verir; onarılmış varsaymayın. Key/CBC secret'ını iş bitince ortamdan kaldırın. Başarısız decode ardından partial dosyaları ve kimlik doğrulamayı inceleyin; restore'u zorlamayın.

## Kurtarma — yeni PostgreSQL hedefi

PG18 client/server; sadece **yeni ve boş disposable hedef**. Global roller/parolalar pg_dump içinde değildir. Kaynak rollerin owner/runtime adları, nitelikleri ve üyeliklerini güvenli ayrı envanterden inceleyip aynı adlarla provision edin. Kör pg_dumpall rol import'u yok; SUPERUSER/NOCREATEDB ihlali veya geniş GRANT ile restore'u yeşile çevirmeyin. Kaynak owner farklıysa onaylı ayrı eşleme planı gerekir; `--no-owner` ile sessiz remap yok.

Restore için güvenilir **non-superuser** migration owner bağlantısını yerel libpq environment/service ile kurun; parolayı argümana koymayın. `$RESTORE_DB_NAME` yalnız DB adıdır; host/port/user/password/TLS PGHOST/PGPORT/PGUSER/PGPASSWORD/PGSSLMODE gibi güvenli yerel ortam alanlarından gelir:

```bash
pg_restore --dbname="$RESTORE_DB_NAME" --single-transaction --exit-on-error "$NEW_DUMP"
```

**--clean / --if-exists yok.** Mevcut DB'ye restore yok. Sahip/rol/grant eksikse rollback ve durdurma gerekir. Eski `--no-privileges` ile üretilmiş CBC backup'ının içermediği izinler decrypt ile geri gelmez: yeni tam backup veya ayrı incelenmiş ACL/owner envanteri şarttır. Yalnız yeni restore komutuna geçmek geçmiş arşivleri onarmaz.

### Restore kabulü

- Tüm kaynak/hedef table row counts ve içerik hash'leri, migration ledger, schema/table/column/sequence owner/ACL, default privileges, global ilgili role/member nitelikleri, fonksiyon SECURITY DEFINER/search_path/GRANT/REVOKE tanımları eşit olmalı.
- Restricted gerçek LOGIN ile checkout preview200/order201/replay200/conflict409, stok rezervasyonu ve hukuk kanıt immutability/negatif erişimler doğrulanmalı. Bu çağrılar yalnız disposable fixture'da yazma yapmalıdır.
- Eksik rol, yanlış key, bozuk ciphertext ve yanlış checksum testleri fail-closed olmalı; başarısız restore'da transaction rollback doğrulanmalı.
- Ayrı cihaz/hesap erişim kaybı, key recovery, son kopya yaşı ve quota/failure bildirimlerini en az aylık tatbikatla kontrol edin. Kesin kaynak/commit/run/digest kayıtlarını tutun; kişisel veri veya secret raporlamayın.

## Olaylar, sınırlar ve cutover

Yanlış SQL/migration için mevcut Neon tarihçe penceresi içinde ayrı restore/PITR hedefi değerlendirilir; plan ve güncel window konsolda salt okunur doğrulanır. Snapshot/restore/cutover işlemlerini bu workflow yapmaz. Hesap/sağlayıcı erişim kaybında bağımsız Drive/artifact kopyası ve bağımsız key envanteri gerekir. Yerel internet/elektrik kesintisi tek başına DB restore gerekçesi değildir.

Günlük tamamlanmış backup için hedef RPO24saattir; schedule gecikmesi/başarısızlığı veya quota aşımı bu hedefi bozabilir. RTO gerçek boyut/rol provisioning/key erişimiyle ölçülmeden1saat garantisi verilmez. Artifact30gün retention'ı ve Drive kotası izlenmelidir; burada Drive otomatik silme/retention job'u yok, mevcut yedekler korunur. Ücretli abonelik açılmaz; mevcut hizmet kotası üzerinde maliyet politikası hesap sahibinin kontrolündedir.

Bu yerel adayın test raporu production job çalışması/hosted restore/merge izni değildir. GitHub takvim/run, gerçek backup_reader kapsamı, kasa/rotation/failure notification teslimi ve bağımsız restore release öncesi ayrıca doğrulanmalıdır.
