# EGE TEKNİK — Havale/EFT kayıt güvenliği, uygulama adımı

**Tarih:** 2026-11-02 · **Hedef:** İleride onaylı hukuki yayın sonrası ilk ödeme seçeneği havale/EFT; banka POS'u ve iyzico pasif.

## Mevcut altyapı — tekrar yazılmadı

- `public/checkout.html`: tek seçilebilir ödeme seçeneği, `discovery` sipariş akışı üzerinden **Havale/EFT (sipariş sonrası)**. Bu bir banka tahsilatı değildir.
- `app/api/admin/orders/[id]/payments/route.ts`: `admin:read` ve ayrıca `payments:record` yetkisi; zorunlu `Idempotency-Key`.
- `lib/finance-db.ts`: order-row `FOR UPDATE`, kalan bakiye kontrolü, tek işlem anahtarıyla idempotent finans kaydı, ayrı audit trail, finans defterinden türeyen ödeme durumu. `orders.payment_status` salt kullanıcı beyanıyla yükseltilmez.
- `app/admin/(panel)/orders/order-payments-panel.tsx`: finans yetkilisinin alınan ödemenin türünü ve referansını kaydedebildiği mevcut ekran.

## Bu dalda yapılan dar kapsamlı iyileştirme

1. `manualPaymentSchema`: yalnızca `bank_transfer` türünde **boş banka işlem referansı** server-side reddedilir; `cash` ve fiziksel `pos` kayıtları geriye dönük uyumlu bırakılır.
2. Admin ekranında EFT referansı zorunlu olduğu görünür; finans görevlisine **dekont fotoğrafına veya müşteri beyanına güvenmeme, gerçek şirket banka hesap hareketini doğrulama** uyarısı verilir.
3. `tests/finance.test.ts`: boş/yalnız boşluk EFT referansını reddetme, referans kırpma, nakit/POS uyumluluğu testi eklendi.
4. `tests/finance-db.test.ts`: iki farklı siparişin aynı EFT referansını eşzamanlı kaydetme denemesinde bir kayıt ve bir `BANK_REFERENCE_REUSED` reddi bekleyen gerçek-PG testi eklendi.

## Kritik sınırlar ve kalan mühendislik işi

- **Banka referansı tek başına tahsilat kanıtı değildir.** Gerçek hesaba geçen tutar ve sipariş mutabakatı insan tarafından teyit edilmelidir; tutar/müşteri uyuşmazlıkları ayrıca araştırılmalıdır.
- **Bu dalda ayrıca eklendi:** `recordManualPayment` fonksiyonu EFT banka işlem referansına özel transaction-scoped PostgreSQL advisory lock alıp mevcut `manual/bank_transfer` kaydını tarar. Böylece *aynı düz referans* farklı sipariş veya idempotency anahtarıyla eşzamanlı kaydedilmeye çalışılırsa ikinci tahsilat reddedilir. Gerçek PostgreSQL eşzamanlılık regresyonu `tests/finance-db.test.ts` dosyasına eklendi; **henüz çalıştırılmadı**.
- **Kalan kapsam:** Bu bir DB unique index/constraint değildir; tüm EFT tahsilat yazma yollarının bu fonksiyonu kullanması şarttır. Bankalar arası veya hesaplar arası gerçek işlem kimliği, farklı formatta yazılan referanslar, eski kayıt temizliği, salt-okunur banka ekstre karşılaştırması ve rol bazlı ikinci onay ayrı iş paketidir. Referansın doğru olması, bankaya paranın geldiğinin kanıtı değildir.
- Şirket IBAN'ı, hesap adı, banka hareketleri erişimi, tahsilat sorumlusu, müşteri için havale son ödeme tarihi ve gecikme/iptal prosedürü işletme tarafından sağlanmadan gerçek ödeme bilgisi otomatik verilmez.
- Yeni kart sağlayıcısı etkinleştirilmedi. Banka POS / iyzico onayı, sözleşme, callback ve iade testleri olmadan checkout'ta seçilemez.
- Hukukçu/ETBİS/standart montaj/delivery/return blokajları kapanmadan Production gerçek sipariş kabulü ve hukuki yayın yapılmaz.

## Doğrulama komutları (Mac disposable QA worktree)

```bash
node --test --experimental-strip-types tests/finance.test.ts
node --test tests/checkout-bank-transfer-policy.test.mjs
pnpm test:legal-publication
pnpm typecheck
```

Bu raporun oluşturulması testlerin Mac'te yeniden çalıştırıldığı anlamına gelmez. Eski 84 test sonucu **bu değişikliğe ait yeni test sonucu değildir**.

## 2026-11-02 — Sipariş numaralı havale açıklaması (müşteri adımı)

- `public/checkout.html` sipariş sonucu ekranına `Havale/EFT açıklama referansı` alanı eklendi. Bu alanda **sadece sunucudan dönen sipariş numarası** gösterilir; müşterinin formdan girdiği bir banka referansı kullanılmaz. Kopyalama düğmesinin sonucu erişilebilir durum alanına yazılır.
- `public/store-core.js` referansı `textContent` ile yazar ve Clipboard API varsa kopyalar. Kullanılamıyorsa müşteriye manuel kopyalama mesajı gösterir.
- Banka hesabı, IBAN, son ödeme tarihi ve otomatik ödeme onayı eklenmedi. Müşteri, **yalnız doğrulanmış şirket hesabı kendisine ayrıca iletildikten sonra** ödemeyi yapmalıdır.
- `tests/eft-payment-instructions.test.mjs` statik regresyon denetimi eklendi. Bu testin ve mevcut birim testlerinin yeni commit üzerinde Mac'te çalıştırılması gerekir; **son 49/49 PostgreSQL PASS** önceki commit `b34d019` üzerindedir ve bu müşteri arayüzü değişikliğini test etmez.
- Bir müşteri birden fazla banka transferi yaparsa, referansın **banka işlem kimliği** değil, sipariş eşleştirme açıklaması olduğu unutulmamalıdır. Yönetici tarafından kaydedilen gerçek **banka hareket referansı** ayrı ve benzersizdir. İkisi karıştırılmamalıdır.
- Checkout, ETBİS ve hukukçu onayları nedeniyle Production'da **NO-GO**. Banka POS'u / iyzico kapalıdır.
