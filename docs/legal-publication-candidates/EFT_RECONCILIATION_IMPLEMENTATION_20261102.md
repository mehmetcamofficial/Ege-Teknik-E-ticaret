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

## Kritik sınırlar ve kalan mühendislik işi

- **Banka referansı tek başına tahsilat kanıtı değildir.** Gerçek hesaba geçen tutar ve sipariş mutabakatı insan tarafından teyit edilmelidir; tutar/müşteri uyuşmazlıkları ayrıca araştırılmalıdır.
- **Farklı idempotency anahtarlarıyla aynı banka referansı** için sistemde DB unique constraint yok. Aynı havalenin başka sipariş veya farklı ödeme kaydına ikinci kez eklenmesini önleyecek atomik `(bank account identity, bank transaction ID)` benzersizlik tasarımı, anonimleştirilmiş/erişim kontrollü referans gösterimi, geçmiş kayıt uyumu ve disposable PG migration testleri ayrı çalışma paketidir. **Bu aşamayı PASS olarak göstermeyin.**
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
