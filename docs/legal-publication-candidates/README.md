# EGE TEKNİK — Müşteriye gösterilecek hukuki aday metinler

**YAYIN İZNİ DEĞİLDİR — İNCELEME ADAYLARI**

Bu klasördeki `distance-sales.md`, `pre-information.md`, `kvkk.md` dosyaları `docs/legal-drafts/` içindeki kaynaklardan **yalnızca iç çalışma notları kaldırılarak** türetilmiştir. Şirketin daha önce resmî kayıttan doğruladığı ve kullanıcı tarafından tekrar teyit edilen satıcı adresi korunmuştur: **Cumhuriyet Mah. Ant Sk. No: 7 B, Kuşadası / Aydın**.

İç notların çıkarılması bir hukuki onay değildir. Özellikle Mesafeli Satış Sözleşmesi'ndeki 4 m standart montaj kapsamı ve diğer işletme şartları **doğrulanmadığı için yayın kapısı bilerek kapalıdır**. Doğrulama dosyası `release-gates.json` içindedir.

## Otomatik denetim

```bash
pnpm test:legal-publication
node scripts/verify-legal-publication.mjs --structural-only
pnpm verify:legal-publication
```

- İlk komut adayların kaynakla eşleşmesini, iç not tespitini ve açık yayın kapılarının reddini test eder.
- İkincisi salt-okunur yapısal kontrol yapar. **PASS yayın izni değildir.**
- Üçüncüsü tüm insan onayı ve işletme kapılarını kontrol eder; bunlar açıkken beklenen sonuç **BLOCKED / nonzero exit**'tir.
- Bu kontroller ağ, veritabanı, ödeme, sipariş veya Production işlemi yapmaz.
- `release-gates.json` içindeki onay alanlarını yalnız yetkili insan onaylarının bağımsız, doğrulanabilir kayıtlarıyla kapatın. Otomatik betik bir imzanın gerçekliğini kanıtlayamaz.
- Sipariş alanındaki `{{...}}` tokenları yalnızca sunucunun gerçek sipariş bağlamıyla çözümlenmelidir; değişkenleri sabit sahte bilgilerle değiştirmeyin.
- Production yayınından önce ayrıca `hashLegalDocument({title,body})` kanonik veri özetini nihai hukukçu onaylı metne göre üretin. Kaynak dosya SHA-256 değeri bu özetle aynı şey değildir.
- Üretime aktarım, owner taslağı, yayın anı ve sürüm kabulü yalnız ayrı açık yetki ve onay sürecinde yürütülür.
