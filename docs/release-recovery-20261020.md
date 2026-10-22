# Ege Teknik — kalıcı release kurtarma ve kabul

Tarih: 20.10.2026. **Yerel aday doğrulandı; release readiness BLOCKED, Production NO-GO.**

Kalıcı alan: `~/Developer/ege-teknik-production-release`
Dal: `release/consolidation-recovered-20261020`
Doğrulanan uygulama kodu checkpoint’i: `0cea6fc73840d0ad5069d0900da0623cac60d96b`.

## Kurtarma sonucu ve kaynak sınırı

VS Code, Cursor ve Antigravity History/Backups taramasında hedef kaynak bulunmadı. Codex’in kalıcı oturum kayıtlarında dosya oluşturma/değiştirme içerikleri bulundu. Bu içerikler kısıtlı dosya işlemleriyle çıkarıldı; geçmiş shell/SQL/ağ komutları topluca çalıştırılmadı. Kaynak kayıtları, Git commit’leri ve mevcut ikinci el dosyaları kullanıldı. [İlk içerik/provenance envanteri](recovery/source-recovery-manifest.json), [son kaynak SHA-256 envanteri](recovery/accepted-source-sha256.json).

Yerel Time Machine ve Data APFS snapshot listeleri boştu; bağlı harici fiziksel disk bulunmadı. Geçmiş/yedek silinmedi. Kayıp `/private/tmp` ağaçları yeniden oluşturulmadı.

| Bileşen | Durum | Kanıt / sınır |
|---|---|---|
| B1–B2 tasarım, ana sayfa, navigasyon | RECOVERED | Public HTML/CSS/JS, ilgili testler ve yeni tarayıcı kanıtları |
| B3 katalog/arama/filtre/URL | RECOVERED | Çoklu filtre, debounce, geri/ileri ve paylaşılabilir URL testleri |
| B4 ürün/galeri/karşılaştırma | RECOVERED | 11 ürünün tam eşlemeleri kayıt çıktısı + katalogdan çıkarıldı; yeni kaynak HTTP doğrulaması 11/11 |
| B5 motion | RECOVERED | Token’lar, reduced-motion; storefront’ta 0ms, admin kaynak kuralı ve erişilebilir etkileşimler |
| B6 seçici/servis | RECOVERED | Deterministik kapasite, keşif sınırları, gerçek yerel servis POST/idempotency |
| B7 Admin Pro/finans | RECOVERED | Mevcut sunucu RBAC korundu; okunur finans ve ikinci el yayın kapısı doğrulandı |
| B8 SEO/analitik | RECOVERED | Metadata/Offer/canonical/robots/sitemap/rıza/PII regresyonları yeni unit setinde geçti |
| B9 AI | RECOVERED | Varsayılan kapalı; mock sağlayıcı, bütçe/eşzamanlılık ve PostgreSQL atomiklik testi |
| B10 müşteri yolculuğu | RECOVERED | Geri bildirim, checkout başlığı ve discovery regresyonları; yeni gerçek tarayıcı akışları |
| PR #22 | RECONSTRUCTABLE / entegre | `1c51d5ac9752e76928988d80e21f402ecc1ac80a` taban olarak kullanıldı |
| PR #23 | RECONSTRUCTABLE / entegre | `83b26924aed2b29b79b15bcd5b709fd18c623b22` içindeki 8 backup dosyası bayt düzeyinde aynı |
| 0021 ikinci el migration | RECOVERED / yeniden konumlandırıldı | Eski eklemeli 0015 içeriği zincirin sonuna 0021 olarak eklendi; journal idx21 |
| Skip-link / Sonner | RECOVERED | Akış içi görünür skip-link; light success `#006b24`; yeni focus/axe kanıtları |
| Onay hukuk bağlantıları | RECONSTRUCTED, PASS | Yeni testte 768px target-size hatası üretildi; yalnız link hedefi >=24px yapıldı, 15/15 tekrar geçti |
| Eski `.scratch/readiness` | PARTIAL / MISSING | SQL taslakları ve bazı sürücü kaynakları kurtarıldı; eski nihai sonuç dosyaları tam bulunamadı |
| Eski 808/781 dosya manifest eşdeğerliği | UNKNOWN | Tam eski SHA envanteri bulunmadı; işlevsel testler bayt eşdeğerliği kanıtı değildir |
| Production dump | RECOVERED, yalnız bütünlük | 118363 bayt; SHA-256 `f46dbfa374058e167e78b93b260b8f0ae4821d8b00f4ffd1700f82b531b9fd57`; içerik Git’e/rapora kopyalanmadı |

PR #22 ile bilinen main `6e33b7abdf06411e7ac66d17aa03eeea7f8215cb` arasında ortak ata yoktur. Merge/force yapılmadı. Main’e özgü **32 eski dosya** (kök HTML/CSS, eski admin ve ChatGPT auth wrapper’ları dahil) [ayrı SHA envanterinde](recovery/main-only-inventory.json) kayıtlıdır ve kaynak commit’te korunur. Çakışan eski `app/page.tsx`/`app/admin/page.tsx` aktif ağaca geri eklenmedi. Eski admin’in kullandığı 11 API yolu mevcut admin route’larına karşılık gelir; bu, tüm eski davranışların birebir eşdeğerliği iddiası değildir. PR #22’nin korumalı admin’i ve canonical storefront routing’i esas alındı.

## Yerel commit’ler ve kalıcılık

- `4006468ab2e1d5accefe236ff9ebad8ab33c0774 recovery: preserve extracted premium sources and verified backup candidate`
- `efa4782d4a77bdd06d98e136908649b9d8d0a539 recovery: restore exact product image mappings and second-hand schema`
- `0cea6fc73840d0ad5069d0900da0623cac60d96b recovery: validate persistent release and repair confirmation link targets`

Bu rapor ve kanıtlar ayrıca bir yerel teslim commit’iyle korunur; son SHA `git log -1` ile görülebilir. Bağımsız `.git` ve kalıcı bağımlılık kopyası vardır; orijinal çalışma ağacına/silinmiş `/tmp` dizinine node_modules bağlantısı yoktur. `gc.auto=0`; yalnız bu repoda remote push URL’si `DISABLED` yapılmıştır. Remote’a yazılmadı.

Yerel güvence: `.recovery-private/checkpoints/ege-release-20261020.bundle` ve yanında SHA-256/verify kaydı. Bu aynı disk üzerinde ikinci bir kopyadır; harici/offsite yedek yerine geçmez. Bundle yerel teslim commit’inden sonra oluşturulur.

## Gerçek yeni test sonuçları

| Kontrol | Sonuç | Kanıt |
|---|---|---|
| TypeScript | PASS | [log](recovery/evidence/typecheck-final.log) |
| Lint | PASS: 0 hata, 5 mevcut uyarı | [log](recovery/evidence/lint-accepted.log); private araç/engine dizinleri uygulama lint kapsamı dışında |
| Normal production build | PASS, Next 16.3.6 Turbopack | [son build](recovery/evidence/build-accepted.log); font mock’u/alternatif bundler yok |
| Hermetik regresyon | **1548 PASS, 0 FAIL, 77 SKIP** | [log](recovery/evidence/unit-accepted.log) |
| Gerçek PostgreSQL | **22 + 19 + 38 + 1 = 80 PASS, 0 SKIP** | [migration/entegrasyon](recovery/evidence/postgres/integration-final.log), [hukuk](recovery/evidence/postgres/legal.log), [commerce](recovery/evidence/postgres/commerce.log), [AI bütçe](recovery/evidence/postgres/ai-budget.log) |
| 77 skip’in durumu | Ayrı DB koşularında kapsandı | 80 yürütme, aynı suite’lerdeki 3 hermetik test tekrarını da içerir; 77+80 benzersiz test olarak toplanmaz |
| ACL/immutability | **63 PASS** | [log](recovery/evidence/postgres/acl.log); 42501/23001 retleri, gerçek LOGIN rolleri |
| Temiz kurulum / 0013 yükseltme | PASS, 22 migration | [sonuç](recovery/evidence/migration-results.json), [22 SHA](recovery/migration-sha256.json); önceki 21 SQL dosyası PR #22 ile aynı; 2 sentetik eski satır korundu |
| Gerçek HTTP checkout | PASS | [log](recovery/evidence/postgres/checkout-http-final.log); stok, idempotency, çakışma, hukuk kanıtı ve yanlış scoped parola reddi |
| Gerçek HTTP RBAC | 4 rol senaryosu PASS | [matris](recovery/evidence/rbac-results.json); anonim/viewer yazma 403; kullanıcı yönetimi super_admin; mevcut finance-read politikası korundu |
| Backup otomasyonu / actionlint | **21/21 PASS**, actionlint PASS | [testler](recovery/evidence/backup-automation-21.log), [actionlint](recovery/evidence/actionlint-final.log) |
| Sentetik GCM restore | PASS, 44 tablo, veri/nesne ACL-sahiplik/default farkı 0 | [sonuç](recovery/evidence/backup/result.json); PostgreSQL18.6, yeni geçici anahtar, yanlış anahtar/bozuk dosya retleri |

Backup restore hedefi aynı yeni izole cluster’da farklı boş DB’dir. Global PostgreSQL rollerinin başka cluster’a yeniden kurulması bu testin kapsamı değildir. Production arşivinin yeniden decrypt/restore’u veya Production verisiyle migration provası **bu kurtarma turunda yapılmadı**. Yerel sentetik sonuç bunların yerine kullanılmaz.

İlk başarısızlıklar saklandı: eksik resim modülü (1544/1), eksik ödeme notu, test-helper’ın yanlış kapsamda yer alması (1547/1), bağımlılık kopyası tamamlanmadan başlayan DB koşusu, trust-auth fixture nedeniyle yanlış parola kontrolünün başarısızlığı, restore sürücüsünde eksik `--dbname`, göreli hukuk URL’si/karşılaştırma seçicisi sürücü hataları ve gerçek link target-size ihlali. Sonuçlar kaynak/fixture/sürücü düzeltmelerinden sonra yeniden doğrulandı; testler devre dışı bırakılmadı. Test-only bootstrap uygulama import kapsamına alınmadı. [Önceki başarısız koşu](recovery/evidence/unit-final.log), [target-size önce](recovery/evidence/checkout-browser/results-before-target-size.json).

## Tarayıcı, erişilebilirlik ve ekran kanıtları

Chrome **155.0.8059.85**, Firefox **157.0**, WebKit **27.2**. WebKit gerçek Safari diye adlandırılmadı.

- 320/375/768/1024/1440px: **150 sayfa**, normal+odaklı **300 axe taraması**, 0 ihlal, 0 yatay taşma; görünür odak 150/150. [Matris](recovery/evidence/browser/results.json).
- Gerçek sipariş oluşturma/onay/hukuk bağlantıları: **15/15 PASS**, tüm motor/genişlik kombinasyonları. [Matris](recovery/evidence/checkout-browser/results.json).
- Skip-link sonrası main içeriğine klavye geçişi, mobil Escape/odak dönüşü: **6/6 PASS**. [Matris](recovery/evidence/keyboard-results.json).
- İkinci el taslak201 / eksik yayın422 / tam yayın200, servis201 / replay200 / tek DB kaydı: **3/3 PASS**. [Matris](recovery/evidence/flows/results.json).
- Arama/filtre/URL/geri-ileri, mobil filtre focus, galeri ok tuşları, karşılaştırma, deterministik seçici ve kapalı AI: **6/6 PASS**. [Matris](recovery/evidence/discovery-results.json).
- 11 GREE görselinin resmi ürün og:image eşlemesi ve image HTTP200 doğrulandı. İlk 429 yalnız ilgili sayfada bir defa yeniden kontrol edildi; ilk kayıt korundu. [Kanıt](recovery/evidence/official-images.json).
- **Gerçek Safari 26.6.2: BLOCKED.** Uygulamadan bağımsız minimal oturumda RWI/session timeout. Profil, izin veya güvenlik ayarı değiştirilmedi. [Kanıt](recovery/evidence/safari-driver.json).

[Ekran görüntüleri](recovery/evidence/screenshots/) yalnız sentetik fiyat/stok/sipariş ve test hukuk metinlerini gösterir. Örnekler: [mobil katalog](recovery/evidence/screenshots/chrome-catalog-375-focus.png), [masaüstü katalog](recovery/evidence/screenshots/chrome-catalog-1440-focus.png), [WebKit sipariş onayı](recovery/evidence/screenshots/webkit-confirmation-1440.png). Eski adayın kayıp ekranlarıyla önce/sonra kıyas üretilemedi; eski görsel kanıtlar PASS yerine kullanılmadı.

## Performans: yalnız yeni laboratuvar verisi

Normal Next production server, loopback HTTPS, sentetik DB, Chrome CPU4x; her sayfa/genişlik için 5 yeni context, p75. Ağ emülasyonu yok; resmi görsellerin ağ/cache etkisi vardır. Gerçek arama yazımı, galeri tıklaması ve finans select klavye etkileşimi kullanıldı. [Ham 30 koşu ve yöntem](recovery/evidence/performance/result.json).

| Sayfa | Genişlik | LCP ms | INP ms | CLS |
|---|---:|---:|---:|---:|
| catalog | 375 | 476 | 24 | 0.0087 |
| product | 375 | 448 | 48 | 0.0000 |
| finance | 375 | 144 | UNKNOWN | 0.0116 |
| catalog | 1440 | 100 | 24 | 0.0000 |
| product | 1440 | 472 | 48 | 0.0000 |
| finance | 1440 | 196 | UNKNOWN | 0.0695 |

Finans INP’sinde 5/5 ölçüm oluşmadığı için p75 UNKNOWN bırakıldı. Saha CWV, gerçek dönüşüm oranı ve B10’a göre önce/sonra performans farkı **UNKNOWN**. Ölçülen değerlerden Production performans garantisi çıkarılmaz.

## Yerel yeniden çalıştırma ve koruma

Uygulama: `npm run typecheck`, `npm run lint`, `npm run build`. PostgreSQL wrapper’ları yalnız yeni `sprintb*` loopback DB’lerine yönlendirilmelidir. `tests/support/recovered-migrations.mjs` CI=true + sabit izole hedefi doğrular; yeni hedef isimleri çakışırsa mevcut DB’yi silmeden durur.

Mevcut bu tur fixture’ı `.scratch/recovery/postgres/data` altında durdurulmuştur. Aynı test ortamını kullanmak için PG18.6’yı yalnız bu data diziniyle 127.0.0.1:55489 üzerinde başlatıp `node tests/support/recovery-browser-server.mjs` ile yerel sunucuyu açın. TLS/private session dosyaları `.recovery-private` altındadır; süreleri dolduğunda mevcut DB’yi resetlemeyin. `recovery-browser-seed.mjs` yalnız yeni, boş disposable DB’ye CI=true ile çalışır, dolu DB’yi reddeder. Provision helper’ı aynı kabul fixture komutlarından toparlanıp lint edildi; yeni dosyanın sıfırdan provision koşusu ayrıca tekrarlanmadı.

Tarayıcı araçlarının paket sürümleri `recovery/tool-versions.json` içinde sabittir; uygulama package.json/lockfile’ına ek bağımlılık eklenmedi. Yeni kabul sürücüleri `scripts/test-recovered-*.mjs`, performans `scripts/measure-recovered-release.mjs` dosyalarındadır. Eski B-fazı sürücülerinin `/tmp` varsayımları tarihsel kaynak olarak tutuldu; yeni kabul için kullanılmadı.

`.recovery-private`, `.scratch`, .env ve dump/şifreli dump/bundle dosyaları Git dışında tutulur. Kaynak dump ve kontrol edilen 10 orijinal dosya değişmedi. [Korunan kaynak kontrolü](recovery/protected-source-check.json). Orijinal B10 dizini hâlâ bulunamadığı için eski781 manifest kıyası UNKNOWN.

## Kalan engeller ve yayın sırası

1. Gerçek Safari müşteri kabulü: BLOCKED; otomasyon erişimi düzeltilmeli veya onaylı manuel gerçek Safari kanıtı alınmalı.
2. Hosted Preview ve bu adayın GitHub CI sonucu: BLOCKED, bu görevde push/deploy yetkisi yok; yerel sonuç hosted kabul değildir.
3. Production’ın güncel ledger/rol durumu ve Production kopyasında 0014–0021 provası: UNKNOWN; bu tur yalnız sentetik kurulum/yükseltme yapıldı. Önceki kayıp sonuçlar kullanılmadı.
4. Production restore ve yetkili hosted/offsite restore kabulü ayrıca doğrulanmalı; sentetik 44 tablo testi bunun yerine sayılmaz. Recovery hardening/rollback SQL’leri yalnız taslaktır; Production’da uygulanmadı.
5. Orijinal 808 dosyanın birebir eşdeğerliği ve B10 karşılaştırma kanıtı UNKNOWN. Kaynak manifesti sonradan bulunursa bu adayın envanteriyle karşılaştırılmalı; aksi halde yeni aday olarak kapsam onayı alınmalı.
6. Güvenlik/hukuk incelemesi, migration uygulama, push/merge ve Production deploy için ayrı açık onay gerekir. Hiçbiri yapılmadı.

Geri dönüş: mevcut orijinal ağaçlar değiştirilmedi; Production rollback gerektiren işlem yok. Yerel checkpoint’ler ve bundle’dan yalnız yeni boş bir dizine kopya çıkarılabilir. Bir düzeltme geri alınacaksa kaynak silmek/reset yapmak yerine izole dalda incelenen revert kullanılmalı. Gerçek backup anahtarları ve Production dump Git’e veya rapora eklenmez.

**Karar: yerel işlevsel release adayı ve kalıcı kurtarma kanıtları hazır; Production NO-GO / release readiness BLOCKED.**
