# EFT-04B — İzole PostgreSQL şeması ve kabul sınırları

Tarih: 2026-11-02 · Dal: `fix/legal-review-address-kvkk-20261102` · Sonuç: **ADAY — Mac testleri bekleniyor**.

## Uygulanan aday kod

- `drizzle-pg/0026_eft04b_bank_reconciliation.sql`: mevcut `0025` üzerine **yalnız yeni tablolar** ekler. Migration journal'a kaydedildi, Production/Preview'da **çalıştırılmadı**.
- `db/schema.ts`: aynı üç tablonun Drizzle modeli.
- `tests/eft04b-db.test.ts`: sentetik hesap, banka hareketi, tekillik, dört göz onayı, otomatik ödeme yokluğu ve rol matrisi.
- `scripts/test-commerce-postgres.mjs`: test grubunu existing disposable PostgreSQL gate'e ekler. Gate her suite öncesi şemayı **sıfırlar**; yalnız `scripts/test-eft-isolated-pg18.sh` ile açılan, sahip olunan yeni cluster'da çalıştırın.

### Tablolar ve sert veritabanı kuralları

| Tablo | Alanlar | DB koruması |
|---|---|---|
| `merchant_bank_accounts` | bank_code, account_label, **iban_last4**, status, verified_by/at, approved_by/at | TRY, son 4 rakam, verified için ayrı iki kişi |
| `bank_movements` | bank_account_id, bank_transaction_id, amount_tl, direction, memo, occurred_at, status | `UNIQUE (bank_account_id, bank_transaction_id)`, amount > 0, kapalı durum listeleri |
| `eft_reconciliation_reviews` | movement_id, order_id, status, reviewed_by/at, approved_by/at, gerekçe | Hareket başına tek inceleme, approved için gerçek sipariş ve ayrı iki kişi |

**Bu migration doğrulamaların yalnız biçimsel/şema düzeyini sağlar.** `verified_by` ve `approved_by` alanları bu aşamada FK veya oturum kimliğiyle bağlı değildir. Yetkili kişi gerçekten giriş yaptı, banka ekstresini gördü ve bağımsız onay verdi iddiası yapılamaz. Bunun için ileride `payments:configure` ve ayrı yetkili sunucu servisleri gereklidir.

### Kesinlikle etkinleştirilmeyenler

- Tam IBAN, hesap parolaları ve banka API anahtarı **saklanmaz**.
- Banka entegrasyonu, CSV/ekstre içe aktarma, yönetici API ve arayüzü **yok**.
- Yeni tablolara genel erişim sağlayan bir GRANT ve tahsilatı otomatik oluşturacak trigger **yok**.
- Mevcut `payments`, `refunds`, `orders`, admin rol/izin kayıtlarının hiçbirinde değişiklik yok.
- `approved` mutabakat statüsü **ödeme tahsil edildi** anlamına gelmez; finans defterine otomatik yazılmaz.
- İsim/etiket ve son dört hane hesap sahipliğini doğrulamaz. Banka bazında gerçek işlem referansları farklı formatlarda olabilir; adaptör tasarımından önce kesin finansal mutabakat iddiası kurulamaz.
- Mevcut finans sistemi tam TL tutarı kullanır. Kuruşlu banka hareketi verileri için kayıpsız birim dönüşümü tasarlanmadan gerçek ekstre içe aktarımı yasaktır.

## Test kapısı

Mac'te mevcut izole QA worktree'sinde:

```bash
set +u
cd "$HOME/Developer/ege-teknik-release-20261101"
git fetch origin fix/legal-review-address-kvkk-20261102
cd "$HOME/Developer/ege-legal-publication-qa"
git status --short
git checkout --detach origin/fix/legal-review-address-kvkk-20261102
pnpm typecheck
pnpm verify:migrations
node --test --experimental-strip-types tests/eft04b-db.test.ts
bash scripts/test-eft-isolated-pg18.sh
```

**Dikkat:** Tek başına `node --test tests/eft04b-db.test.ts` çalıştırıldığında veritabanı testleri SKIP olabilir; bunun yerine izole runner'ın sonunda `0 skipped` ve EFT-04B gerçek-PG testleri görülmelidir. `git status --short` boş değilse detached checkout öncesi işlemi durdurup değişiklikleri değerlendirin.

## Sıradaki aşama, henüz yapılmadı

EFT-04C: hassas veri/işlem kimliği normalizasyonu, gerçek hesap sahipliği kanıtı, güvenli banka hareketi içe aktarma, uygulama düzeyi ayrı maker/checker RBAC, audit, atomik mutabakat onayı ve ödeme defterine idempotent bağlama. `bank_movements` için DB seviyesinde untrusted direct write erişiminin olmaması, güvenli bağlantı rolleri ve ACL testleriyle doğrulanmalı.

**Production/Preview: NO-GO.** Hukukçu, ETBİS, işletme banka hesabı ve montaj/teslimat/iade onayları açık.
