# ⚠️ DRAFT — LEGAL REVIEW REQUIRED
# NOT PUBLISHED · NOT PRODUCTION LEGAL TEXT

Bu klasördeki dosyalar **yalnızca inceleme amaçlı aday taslaklardır**. Avukat onaylı nihai metin **değildir**,
hukuki tavsiye niteliği taşımaz ve yayınlanmamıştır. Uygulama koduna, veritabanına, Preview veya Production
ortamına **bağlı değildir**; hiçbir dosya çalışma zamanında okunmaz.

## Dosyalar

| Dosya | Slug (ileride) | Türü (3B.4 sınıflaması) |
|---|---|---|
| [distance-sales.md](distance-sales.md) | `distance-sales` | Checkout kabulü |
| [pre-information.md](pre-information.md) | `pre-information` | Checkout kabulü / bilgilendirme |
| [kvkk.md](kvkk.md) | `kvkk` | Aydınlatma (onay kutusu değil) |
| [privacy.md](privacy.md) | `privacy` | Site bilgilendirmesi |
| [cookies.md](cookies.md) | `cookies` | Site bilgilendirmesi (koşullu) |
| [delivery-returns.md](delivery-returns.md) | `delivery-returns` | Checkout bilgilendirmesi + site sayfası |
| [terms.md](terms.md) | `terms` | Site bilgilendirmesi |
| [marketing-consent.md](marketing-consent.md) | (ayrı, isteğe bağlı) | Ayrı isteğe bağlı izin |
| [installation.md](installation.md) | (checkout bilgilendirmesi) | Koşullu bilgilendirme |
| [warranty.md](warranty.md) | (ürün bazlı model) | Bilgilendirme modeli |
| [VERIFICATION_REQUIRED.md](VERIFICATION_REQUIRED.md) | — | **Çözülmemiş tüm alanların kaydı** |
| [IMPLEMENTATION_DEPENDENCIES.md](IMPLEMENTATION_DEPENDENCIES.md) | — | Yayından önce uygulamada gerekenler |
| [SOURCES.md](SOURCES.md) | — | Kullanılan resmî kaynaklar ve kısıtlar |

## Yer tutucu kuralları

- `[DOĞRULAMA BEKLİYOR: alan]` — doğrulanmamış işletme/hukuki bilgi. **Yayından önce mutlaka çözülmelidir.**
  Hiçbir yer tutucu gerçekçi görünen sahte bir değerle doldurulmamıştır.
- `{{SIPARIS_NO}}` gibi çift süslü parantezler — sipariş anında sistem tarafından doldurulacak çalışma zamanı alanları.
  Doğrulama yer tutucularından farklıdır ve taslaklarda örnek değer içermez.
- `> **İnceleme notu:**` — avukat/işletme sahibi için not; yayınlanacak metne **alınmamalıdır**.

## Bilgi kaynağı ayrımı

- **Operatör beyanı:** işletme sahibinin bildirdiği bilgiler (marka, sahip, adres, e-posta, telefon, iş modeli).
  Sicil/vergi belgesiyle henüz doğrulanmamıştır.
- **Resmî kaynak:** Mesafeli Sözleşmeler Yönetmeliği'nin Ticaret Bakanlığı'nın yayımladığı güncel metni (madde
  numaraları taslaklarda belirtilmiştir). KVKK ve ticari ileti kuralları için bkz. [SOURCES.md](SOURCES.md).
- **Öneri:** taslak yazarının tasarım tercihi; hukuki incelemeye tabidir.

## Yayın yolu (henüz uygulanmayacak)

Onaylanan metinler ileride yalnızca Faz 3B.3 yönetim akışıyla (taslak → yayın) ve yalnızca doğrulanmış
alanlar doldurulduktan sonra yayınlanabilir. Preview'daki test belgeleri (`PREVIEW TEST`, `PHASE 3B.3 ...`)
ile bu taslaklar **karıştırılmamalı**; Production'a hiçbir test içeriği taşınmamalıdır.
