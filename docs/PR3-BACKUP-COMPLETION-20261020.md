# PR #3 — GCM, Google Drive ve recovery tamamlama

**Sonuç: PASS — yerel PR #3 adayı ve gerçek sentetik Drive/restore kapsamı. Production/hosted günlük çalışma henüz etkinleştirilmiş veya kabul edilmiş değildir.**

20.10.2026. İzole alan `/Users/mehmetcam/Developer/ege-pr3-acl-gate`; HEAD `5c78af2e30be5663ae27f7cb8c9715fa5174d012` (detached HEAD). Commit/push/merge/deploy yok. Kullanıcının mevcut workflow/runbook/ETGCM002 değişiklikleri başlangıçta kaydedildi, kaybolmadı. Orijinal ağaç, PR #22 ve Production/Preview/Neon değiştirilmedi.

## Tamamlanan bütünleşik değişiklik

- Yeni backup varsayılanı **ETGCM002/AES256GCM**. Mevcut streaming modül korundu; canonical32byte base64 key ve tam CLI argüman sayısı doğrulaması eklendi. Header+nonce AAD,16byte auth tag; final output sadece authentication başarılıysa atomik publish edilir. Var olan çıktı overwrite edilmez.
- Workflow checkout/Node24/PG18 kurulumu ve secret'sız21 test job'u içerir. Major18 zorunlu; backup testi başarısızsa production job başlamaz. GCM encrypt/decrypt/byte-eşitlik/archive-list selfcheck'i geçmeden encrypted artifact yayınlanmaz.
- `backup-dump.mjs` doğrudan URI'yi libpq ortam alanlarına ayırır; URI/parola/GCM key subprocess argv'sinde yok. TLS/channel_binding korunur; bilinmeyen parametre fail-closed. ACL/owner/default privilege dump'tan çıkarılmaz.
- Eski **Salted__ CBC/PBKDF2/200000** arşivleri yalnız güvenilir SHA256 +özgün parola +`--allow-legacy-cbc` ile kurtarılır. Bozuk GCM CBC'ye düşmez; ETGCM001/tanınmayan biçimler reddedilir. Önceden ACL'siz üretilmiş arşivlerin eksik ACL'si decrypt ile geri gelmez; runbook bunu açıklar.
- Drive aktarımı doğru hesap ve explicit folder ID, private/yazılabilir klasör, geçici0600 OAuth config, immutable upload ve3 dosyanın download/SHA256 eşitliğini zorunlu tutar. Key/DB URL transport ortamına verilmez. Metadata yalnız format/algorithm/key-id/PGmajor alanlarıdır.
- Günlük01:30UTC, artifact30gün, opsiyonel R2 korundu. Kısmi R2 config fail olur. Failure/cancel annotation/summary job'u ve job-scope cleanup tamamlandı; gerçek e-posta teslimi doğrulanmadı.
- Runbook; eski/yeni format, anahtar rotasyonu/kasa, boş hedef, non-superuser owner/role provisioning, atomik restore, ACL-negatif test ve RPO/RTO sınırlarını tek prosedürde toplar. `--clean --if-exists` kaldırıldı.

## Gerçek test sonuçları

| Kontrol | Sonuç | Kanıt |
|---|---|---|
|GCM/CBC/Drive mock/workflow/secret argv testleri|PASS —21/21,0 fail,0 skip|[log](evidence/pr3-backup-20261020/tests-final.log)|
|actionlint1.7.12|PASS —0 hata|[log](evidence/pr3-backup-20261020/actionlint.log)|
|shellcheck,bash -n,node --check,diff --check|PASS|[check kaydı](evidence/pr3-backup-20261020/checks.json)|
|Eski CBC gerçek44 tablolu sentetik fixture restore|PASS —veri ve scoped envanter eşit|[DB sonuçları](evidence/pr3-backup-20261020/integration-result.json)|
|Yeni GCM gerçek PG18 üretici ve farklı boş DB restore|PASS —44 tablo,owner/ACL/data0 fark|Aynı DB kaydı|
|Runtime order SELECT/product UPDATE/trigger disable|PASS —3/3 SQLSTATE42501|Aynı DB kaydı|
|Gerçek Drive upload/download→hash→GCM decode→farklı PG restore|PASS —3 obje,44 tablo,veri/ACL0 fark|[canlı sentetik sonuç](evidence/pr3-backup-20261020/live-drive-result.json)|
|Başlangıç dosyaları/önceki kaynak koruması|PASS —yalnız beklenen3 mevcut dosya değişti; B10 781/781 aynı|[baseline](evidence/pr3-backup-20261020/baseline-check.json),[B10](evidence/pr3-backup-20261020/b10-integrity.json)|
|Gerçek GitHub Ubuntu job/cron/bildirim teslimi/R2 readback|UNKNOWN —çalıştırılmadı|Push/workflow dispatch veya prod bağlantısı kullanılmadı|
|Checkout HTTP /tüm uygulama build/TS/lint /bağımsız63 ACL seti|Bu tur NOT RUN|Backup kapsamı; uygulama bağımlılığı kurulmadı, application/PR22 kodu değiştirilmedi. Önceki kullanıcı PASS'ları yeni yürütme sayılmadı|

Testler Node24.15.0, PG18.6, rclone1.75.2 üzerinde gerçekten Mac Terminal araçlarıyla çalıştırıldı. Test-only harness, mevcut sentetik encrypted fixture'ı okudu; yeni2 kaynak/hedef denemesinde toplam4 disposable küme oluşturdu. Önceki DB'ler açılmadı. Bootstrap lokal fixture bağlantısı trust ile yalnız loopback'e bağlıydı; bu password authentication testi değildir. Restore/runtime owner ve roller non-superuser; rol yetki kontrolleri3 dar LOGIN adıyla yapıldı. Production'da trust kullanılmamalı, gerçek restricted LOGIN/backup_reader kabulü ayrı yapılmalıdır.

## Drive hedefinin doğrulanması

Eski konuşmada verilen156boYt-CsTxXm0uoxBtPmrKyYyuFrz8G için Google folder metadata **404** döndü; gizlice fallback yapılmadı. Aynı credential ile Google about.user200 ve hesap eşleşmesi true. [Salt okunur ayrım](evidence/pr3-backup-20261020/drive-diagnostic.json).

Bu görevin başlangıç workflow'u `ege_teknik_backup:Ege-Teknik-Backups-Automated` yolunu kullanıyordu. Bu **mevcut tam ad** salt okunur sorguda tek private/yazılabilir klasöre çözüldü: **`1dVSxt7a2yyovyGZnEmAUzY89gyRSJBPq`**. [Tekil metadata](evidence/pr3-backup-20261020/drive-folder-candidates.json). Sadece mevcut workflow hedefinde ve gerçek info@egeteknik.tr kimliği API ile doğrulandıktan sonra yeni sentetik dosyalar oluşturuldu; başka hesap/klasör seçilmedi, paylaşım değiştirilmedi, mevcut dosya silinmedi/değiştirilmedi.

Yeni sentetik dosya: `ege-teknik-synthetic-2026-10-20T00-51-45Z-synthetic-live-20261020-9qhH0rd1.dump.enc`. SHA256 **`67fbbb0bcc4c380abccb11251dc938690d4c125ea523d55b65ef9ef4ad0ff79e`**. Checksum ve public metadata ile3 obje yüklendi; hepsi indirildi ve hash eşleşti. Ciphertext ikinci kez ayrıca indirilip GCM authentication sonrası **başka yeni boş DB**'ye restore edildi.44 tablo hash/sayım,21 migration ledger,3 scoped rol/0 üyelik,2 schema,44 table,8 column ACL,1 sequence,1 default privilege,12 function owner/ACL/search_path/SECURITY DEFINER/definition eşit. Bu küme global rollerin tümünü taşımak veya Production verisi kullanmak değildir.

Live test key'i yalnız bellekte üretildi ve test süreci sonlandı; Drive'daki sentetik test objeleri kalıcı operational backup/anahtar kurtarma kanıtı değildir. Key değeri Drive'a/repoya/loga yazılmadı. Geçici OAuth config ve plaintext dump'lar finally/trap ile temizlendi; asıl rclone config değiştirilmedi. Yeni DB dosyaları ve yalnız encrypted test kopyaları korunuyor. Bu görevin4 PostgreSQL kümesi durduruldu.

## Başarısız denemeler ve düzeltmeler

1. İlk test harness'ında pg_restore için explicit DB seçimi eksikti; fixture kurulumu durdu. [İlk sonuç](evidence/pr3-backup-20261020/integration-initial-result.json). Başarısızlık gizlenmedi; başka yeni kümelerde tekrarlandı.
2. Gerçek PG18 denemesi, URI'nin sadece PGDATABASE ortamında verilmesiyle istemcinin hedefi seçmediğini buldu. [Üretici hatası](evidence/pr3-backup-20261020/producer-diagnostic.log),[ara sonuç](evidence/pr3-backup-20261020/integration-producer-failure.json). `backup-dump.mjs` ile URI ayrı libpq alanlarına ayrıldı; son gerçek producer/restore geçti. Mock teste aynı PGHOST/PGDATABASE/TLS/argv sözleşmesi eklendi.
3. Otomatik onay incelemesi URL'yi `--dbname` argv'sine koyma önerisini gömülü credential sızıntısı riski nedeniyle reddetti. Öneri **uygulanmadı**; güvenli env-field alternatifiyle ilerlenip testi geçti. Ek kullanıcı onayı veya güvenlik kontrollerini devre dışı bırakma yoluna gidilmedi.
4. Önceki folder ID404 nedeniyle ilk live tur BLOCKED kaldı. Mevcut workflow'un gerçek hedefi salt okunur tekil çözülüp son sentetik live tur onun üzerinde PASS oldu. Bu çözüm kodda otomatik folder-name fallback yaratmaz; deployment hâlâ explicit folder variable ister.

## İşletime alma öncesi kalanlar — bu görevde yapılmadı

- GitHub Secrets: `NEON_PRODUCTION_DATABASE_URL_BACKUP`, **yeni `BACKUP_GCM_KEY_B64`**, `EGE_GDRIVE_RCLONE_CONFIG_B64`. Hiçbir secret oluşturulmadı/değiştirilmedi. Gerçek key/value raporlanmadı.
- GitHub Variables: `BACKUP_GCM_KEY_ID`, `EGE_GDRIVE_FOLDER_ID`. Bu testte doğrulanan mevcut Automated folder ID'si `1dVSxt7a2yyovyGZnEmAUzY89gyRSJBPq`; hesabın hedef politikasına göre incelenip açıkça ayarlanmalı. Eski404 ID'yi kullanmayın.
- Eski CBC arşivleri için **BACKUP_ENCRYPTION_PASSWORD'ı silmeyin**. Yeni job onu kullanmaz; özgün parola ve eski GCM version key'leri backup retention boyunca bağımsız güvenli kasada korunmalı. Kasa erişim/rotation/recovery gerçek key'lerle burada denenmedi.
- Gerçek backup_reader'ın PG18 full metadata/table/sequence kapsamı ve gerçek kaynak owner/role envanteri production'a bağlanmadan doğrulanamadı. Yetki genişletme yapılmadı. Yeni production backup veya restore tetiklenmedi.
- GitHub hosted Ubuntu paket kurulumu/checkout/cron ve failure bildirim teslimi bu local testin yerine geçmez; review ve ayrı yetkili CI çalışması gerekir. R2 opsiyonel ve bu tur canlı denenmedi. Drive retention/quota politikası ve GitHub bildirim aboneliği hesap sahibinde kalır.
- Commit/push/merge/deploy açıkça yasaktı; uzak PR#3 hâlâ yerel adaydan farklı olabilir. Kullanıcı ayrıca release yetkisi vermedikçe hiçbir release işlemi yapılmamalıdır. GATE-08 veya premium/legal release READY ilan edilmedi.

## Dosyalar ve geri alma

`.github/workflows/neon-production-backup.yml`, `scripts/backup-crypto-gcm.mjs`, `scripts/backup-decrypt.mjs`, `scripts/backup-dump.mjs`, `scripts/backup-upload-drive.mjs`, `scripts/create-encrypted-backup.sh`, `tests/backup-automation.test.mjs`, `docs/NEON-DISASTER-RECOVERY.md`, bu rapor ve `docs/evidence/pr3-backup-20261020/`.

Geri almada başlangıç diff/hash'leri `/private/tmp/et-pr3-completion-20261020/` altında korunuyor. Yalnız bu görevin eklerini geri alın; kullanıcının başlangıç ACL/Drive/GCM değişikliklerini silmeyin. Reset/clean/stash/force kullanılmadı. Remote test objelerini otomatik silme işi eklenmedi; mevcut yedeklere cleanup uygulanmadı.

## Commit yetkisi sonrası doğrulama

Kullanıcı mevcut PR#3 dalına tek commit ve normal push yetkisi verdi. Uzak PR head ve yerel başlangıç HEAD'i5c78af2e30be5663ae27f7cb8c9715fa5174d012 olarak yeniden eşleşti. Workflow'a secret'sız pull_request test tetikleyicisi ve backup job'unu PR olayında atlayan guard eklendi; schedule/manual davranışı korundu. Bu adım production backup workflow'unu çalıştırmaz.21/21 test,actionlint,shellcheck,bash/node syntax ve diff kontrolleri commit öncesi tekrar geçti. CBC yanlış parolanın nadiren padding'i geçebilmesi testte açıkça modellenir; doğru plaintext/archive doğrulaması hâlâ şarttır.

Commit kapsamı23 açıkça seçilmiş backup kodu/test/dokümantasyon ve sanitize kanıt dosyasıdır. Dosya tipleri, binary içerik, private-key/OAuth/token işaretleri ve beklenmeyen password URI'leri kontrol edildi; bulgu yok. Gerçek dump/ciphertext/rclone config/key commit listesinde yok. Gerçek production işleyişi/CI/push sonucu bu tarihsel test raporundan çıkarılamaz; yayın sonrası ayrı son durum kaydı tutulur.
