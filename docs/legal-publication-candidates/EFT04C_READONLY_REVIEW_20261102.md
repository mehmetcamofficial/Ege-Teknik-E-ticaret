# EFT-04C — Yetkili, salt-okunur mutabakat inceleme akışı

**Durum:** ADAY / Mac testleri bekleniyor. **Production NO-GO.** EFT-04B 54/54 PostgreSQL 18 PASS kanıtı ayrı commit `0cef94a` içindir.

## Bu aşamada uygulandı

- `lib/eft-review-db.ts` mevcut EFT-04B tablolarından banka hareketlerini ve mutabakat inceleme kayıtlarını **salt okunur** getirir; en fazla 50 kayıt döndürür.
- `app/api/admin/eft-reconciliation/route.ts` yalnız `GET` sunar. Aktif admin oturumu, `admin:read` ve ayrıca `payments:record` veya `payments:configure` etkin izni gerekir. Diğer personel reddedilir ve denetim kaydı tutulmaya çalışılır. `Cache-Control: no-store`.
- `app/admin/(panel)/eft-reconciliation/page.tsx` oturum korumalı bir yönetici sayfası açar.
- `review-view.tsx` hareket listesini ve inceleme statüsünü görüntüler. Tam IBAN veya banka sırrı göstermez; yalnız son dört hane ve hesap etiketi vardır.
- `tests/eft04c-readonly-gate.test.mjs` kaynak kodda yalnız GET, RBAC ve ödeme yazma işlemi bulunmaması denetimlerini yapar.

## Güvenlik kapsamı ve açık konular

- **Hiçbir gerçek banka bağlantısı, CSV içe aktarma, gerçek IBAN, kimlik bilgisi, dekont, tahsilat veya mutabakat onay endpoint'i eklenmedi.**
- `verified` / `approved` kayıtları halen yalnız veritabanı düzeyinde metadata CHECK ile korunur. Gerçek banka sahipliği doğrulaması veya oturumdan gelen bağımsız maker/checker kimlikleri bu sürümde bulunmaz.
- Bu ekran **kendiliğinden bir eşleşme çalıştırmıyor**. Önceden kaydedilmiş banka hareketleri ve inceleme kayıtlarını listeler; EFT-04A saf eşleştirme motoru bu endpoint'e henüz bağlanmadı.
- Hareket ID, tutar ve memo kişisel/veri gizliliği incelemesine konu olabilir; gerçek banka CSV içe aktarımı KVKK / erişim / saklama tasarımı tamamlanmadan yapılmaz.
- EFT-04B tablosu Production/Preview'da bulunmuyor olabilir: bu dal **deploy edilmez**, yoksa GET hata verebilir.
- Audit yalnız reddedilen erişim için mevcut izin-denetim mekanizmasından yapılır; her başarılı okumayı audit eden ayrı düzenek henüz yok.
- Görünür sayfa `/admin/eft-reconciliation`. Menü bağlantısı bu dar kapsamda eklenmedi.

## QA komutları (yalnız Mac disposable worktree)

```bash
cd "$HOME/Developer/ege-teknik-release-20261101"
git fetch origin fix/legal-review-address-kvkk-20261102
cd "$HOME/Developer/ege-legal-publication-qa"
git status --short
git checkout --detach origin/fix/legal-review-address-kvkk-20261102
node --test tests/eft04c-readonly-gate.test.mjs
pnpm typecheck
pnpm verify:migrations
bash scripts/test-eft-isolated-pg18.sh
```

**Kabul kriteri:** 4/4 yeni salt-okunur kaynak testleri, TypeScript PASS, migration bütünlüğü PASS, 54/54 gerçek PostgreSQL regresyonları PASS. Bu komutlar bu yeni commit üzerinde henüz çalıştırılmadı. Gerçek HTTP üzerinden admin oturumu/RBAC E2E ayrıca gerekli ve henüz PASS sayılamaz.

## Gelecek adım — EFT-04C.2 (henüz uygulanmadı)

- Veritabanı hareketleri için gerçek admin okuma oturumu ile 200/403 HTTP testleri.
- Banka hesaplarını yönetmek için `payments:configure` + oturum kimliği + ayrı onaylayıcı ve audit.
- Kontrollü banka hareketi içe aktarımı, kaynak doğrulama ve kuruş/TL kesin dönüşümü.
- Atomik ve idempotent iki aşamalı mutabakat kararı. **Onay ödeme defterine otomatik yazılmaz.**
- Banka referansının aynı hesapta DB UNIQUE ve gerçek hareket kaynağına bağlı olması; eski manuel ödeme kayıtları ve farklı banka hesaplarındaki işlem kimliği çakışmalarının değerlendirilmesi.

**Hiçbir merge, deploy, Production/Preview DB/env değişikliği yapılmadı.**
