# EFT-04 — Banka hesabı yönetimi ve EFT mutabakatı

**Tarih:** 02.11.2026  
**Karar:** Tasarım + saf eşleştirme motoru **REVIEW ONLY**. Gerçek banka entegrasyonu ve otomatik tahsilat yok. Production **NO-GO**.

## Mevcut gerçek durum

- Müşteri yalnız **havale/EFT — sipariş sonrası ödeme** seçebilir; bankanın gerçek hesap bilgileri doğrulanmadığı için müşteriye IBAN yazılmıyor.
- Banka POS'u ve iyzico **kapalı**; sözleşme sonucu bekleniyor.
- `payments` / `refunds` defteri, `payments:record` yetkisi, idempotency, satır kilidi ve audit kaydı zaten mevcut.
- Sipariş onayı müşteriye sunucunun verdiği `orderNumber` değerini **havale açıklaması** olarak gösterir. Bankanın **banka işlem kimliği** bu açıklamadan ayrıdır.
- Önceki Mac kanıtı: izole PostgreSQL 18 ortamında 49/49 test PASS; EFT-04 kodu bu çalıştırmaya dahil değildi.

## Bu committe eklenen ilk uygulama dilimi

`lib/eft-reconciliation.mjs` şu **salt-okunur** işlevleri sağlar:

| İşlev | Davranış | Güvenlik sınırı |
|---|---|---|
| `maskedIban` | TR formatındaki IBAN'ın yalnız kısmi görünümünü üretir | İlgili hesabın gerçekten şirkete ait olduğunu **kanıtlamaz**, checksum doğrulaması yapmaz |
| `reviewBankAccount` | Hesap için asgari doğrulama metadata varlığını kontrol eder | `verified` alanı yalnız bir veri alanıdır, gerçek yetki/imza kanıtı değildir; bu işlev **hesap etkinleştiremez** |
| `assessEftMovement` | Banka hareket açıklamasındaki sipariş numarasını önceden yetkili sistemin okuduğu aday siparişlerle eşler | **Asla ödeme satırı yazmaz**, yalnız `CANDIDATE_ONLY` veya `REVIEW_REQUIRED` döndürür |

Banka hareketinde işlem ID ve tam TL tutarı gerekir. Sayısal değerlerde kuruş varsa ayrı ve test edilmiş adaptör gerekir; mevcut ledger tam TL kullandığı için bu aşamada kuruşlu hareketi tahmini yuvarlama yoktur.

**Açıkça reddedilen durumlar:** doğrulanmamış banka hesabı, tekrar kullanılmış banka işlem kimliği, eşleşmeyen/tekrar eden sipariş numarası, kapanmış sipariş, bakiye yok, eksik/fazla ödeme, uygunsuz tutar. Bu eşleşmelerin hiçbiri finans defterine otomatik yazılmaz.

## Önerilen sonraki veri modeli — HENÜZ UYGULANMADI

1. `merchant_bank_accounts`: şirket sahipliği ve banka teyidinin kanıt referansı, son dört hane, maskeleme, para birimi, durum (`draft/verified/disabled`), dört göz onayı. Tam IBAN gerekiyorsa yalnız şifreli saklama, açık RBAC, audit ve anahtar rotasyonu tasarlanacak; bu aşamada **gerçek IBAN kaydı yok**.
2. `bank_movements`: banka hesabı ID + bankanın gerçek işlem kimliği için DB UNIQUE, giriş/çıkış, TRY tutar birimi, işlem tarihi, müşteri açıklaması, kaynağın kimliği, anonimleştirme/saklama politikası. İçe aktarma yalnız yönetici yetkisiyle; CSV formatı ve banka kaynak doğrulaması önceden belirlenmeli.
3. `eft_reconciliation_reviews`: hareket ID, hedef sipariş ID, önerilen eşleşme, incelenen bakiye, olası hata kodu, finans personeli, bağımsız onaylayan, karar tarihi ve audit kanıtı.
4. `payments` ile bağ: **yalnız banka ekstresiyle doğrulanmış hareket**, `payments:record` + ayrı mutabakat onayı, idempotent tek işlem, DB benzersizliği ve gerekirse geri alma/iade akışıyla kaydedilecek. Mevcut `manual/bank_transfer` kaydının banka hesabı ID ile ilişkilendirilmesi için migration/geriye uyum incelemesi gereklidir.

## Yetki ve süreç kapısı

- Banka hesabı ekleme/onaylama: ayrı `payments:configure` ve owner/finance dört göz süreci; basit metadata bayrağı onay değildir.
- Banka hareketi içe aktarma: yetkili finans çalışanı, kaynak doğrulaması ve PII koruması.
- Eşleştirme adayı: finans personeline **salt-okunur** gösterilir, tüm tutarsızlıklar bekleme kuyruğuna gider.
- Tahsilat kaydetme: yalnız hesapta gerçekleşmiş tutar, finans izinleri, audit ve banka hareketi tekillik kontrolüyle mümkündür.
- Yanlış sipariş eşlemesi, kısmi/çoklu transfer, referans farklılıkları, aynı açıklama numarası ve bankanın işlem ID formatı için ayrıca gerçek PostgreSQL testleri gerekir.

## Testler ve kabul kriteri

```bash
node --test tests/eft-reconciliation.test.mjs
node --test tests/eft-payment-instructions.test.mjs
node --test tests/checkout-bank-transfer-policy.test.mjs
pnpm typecheck
```

Testler henüz Mac üzerinde yeniden çalıştırılmadı. Tam EFT-04 **PASS değildir**; sadece ilk pure-function dilimi yazıldı. Bir sonraki aşamada izinli izole PostgreSQL 18 veritabanı ve sentetik hesap/hareket tablolarıyla atomiklik ve yetki testleri yapılmalı.

**Yayın kararı:** Hukuki belge onayı, ETBİS, 4 m montaj / teslimat / iade doğrulamaları ve şirket banka hesabı kanıtı tamamlanmadığı sürece **NO-GO**. Merge/deploy/Production/Preview DB/env değişikliği yok.
