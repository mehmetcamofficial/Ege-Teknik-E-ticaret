# EGE TEKNİK — LEGAL IMPLEMENTATION DEPENDENCIES

> **INTERNAL · NOT CUSTOMER-FACING**
>
> Bu dosya yalnızca Production legal yayını ve V1 go-live öncesi kalan teknik/operasyonel bağımlılıkları izler. Tamamlanmış eski boşluklar tekrar açık iş gibi gösterilmez.

## Tamamlanmış temel kontroller

- Checkout toplamı server-authoritative ürün/fiyat/vergi/teslimat kurallarıyla hesaplanır.
- Sipariş oluşturma server-side legal version doğrulaması yapar; eksik/eski/fazla acceptance reddedilir.
- `pre-information` ve `distance-sales` checkout acceptance olarak sürümlü tutulur.
- KVKK aydınlatması onay/rıza checkbox'ı değildir; bilgi notice olarak gösterilir.
- Yayımlanmış legal sürümler DB seviyesinde immutable olacak şekilde korunur.
- Sipariş, müşteri, adres, ürün snapshot'ları, marketing tercihleri ve legal acceptances aynı transaction içinde kaydedilir.
- Standart montaj kapsamı ve ek iş onayı prensibi legal RC'lere işlendi.
- Teslimat taahhüdü tüm RC'lerde **1–7 gün** olarak standardize edildi.
- Cayma ve iade metinlerinde güncel **14 gün** kuralı standardize edildi.
- First-party visitor analytics için consent gate eklendi: global `ANALYTICS_ENABLED` + ziyaretçi tercihi birlikte gerekir.
- Ziyaretçi analytics izni geri çekildiğinde HttpOnly `ege_vid` server-side silinebilir.
- Cookie preference UI branch üzerinde mevcut.

## Production go-live öncesi kalan teknik/operasyonel işler

1. **Legal Production publish:** hukukçu/işletme tarafından onaylanan `pre-information`, `distance-sales` ve `kvkk` sürümlerini admin legal flow üzerinden publish et.
2. **Legal smoke:** `/api/legal/required` → 200; exact version linkleri; checkbox kabulü; stale version rejection; order legal acceptance kayıtları; immutable published version testi.
3. **ETBİS:** `egeteknik.tr` şirket/domain kaydı tamamlanmadan gerçek ticari launch yapılmamalı.
4. **Muhasebe/sicil:** MERSİS, KEP, e-Fatura/e-Arşiv, e-belge sağlayıcısı ve VERBİS istisna değerlendirmesi Pazartesi teyidiyle kapatılmalı.
5. **Kargo:** gerçek taşıyıcı, iade taşıyıcısı ve tarife belirlenmeden shipping özelliği aktif edilmemeli. Checkout'ta toplam/ücret satın alma öncesinde kesin görünmeli.
6. **Ödeme:** ödeme kuruluşu gerçekten sözleşmeli/aktif olduğunda legal açıklama, callback güvenliği ve customer-facing yöntem adı birlikte açılmalı. Kart PAN/CVV/expiry uygulama DB/loglarına girmemeli.
7. **KVKK yurt dışı aktarım:** Vercel, Neon, Clerk ve trial devam ediyorsa Sentry için gerçek DPA/region/subprocessor/aktarım mekanizması hukukçu tarafından belgelenmeli.
8. **Saklama/silme matrisi:** sipariş, fatura, legal acceptance, servis, güvenlik/audit ve marketing kayıtları için ayrı saklama gerekçesi/süresi ve silme/anonimleştirme prosedürü oluşturulmalı.
9. **Analytics Production ayarı:** visitor analytics kullanılacaksa Production `ANALYTICS_ENABLED=true` yapılmalı; consent yokken event/cookie oluşmadığı, consent verince dashboard event'i geldiği, geri çekince `ege_vid` silindiği tarayıcı/network üzerinden test edilmeli.
10. **External static resources:** Google Fonts ve Tailwind Play CDN mümkünse self-host/build-time varlıklara taşınmalı. Kalırsa KVKK yurt dışı aktarım incelemesine dahil edilmeli. Tailwind Play CDN aynı zamanda CSP `style-src 'unsafe-inline'` ihtiyacını sürdürüyor.
11. **Clerk Production audit:** kullanılan gerçek Clerk cookie/storage isimleri, süreleri ve network çağrıları browser DevTools ile kaydedilmeli; cookie RC ile karşılaştırılmalı.
12. **Marketing:** İYS/consent/ret/suppression akışı tamamlanmadan promosyon SMS/e-posta/WhatsApp otomasyonu kapalı kalmalı.

## Sipariş özel belge modeli

Genel legal metin her sipariş için yeni bir version olmamalıdır. İspat modeli:

**published legal version + order snapshot + server-side acceptance timestamp/version IDs**.

Order snapshot, ürün adı/fiyat/KDV/adet/teslimat ve siparişe özgü diğer alanları korur. Legal version değişikliği yalnız genel hukuki metin değiştiğinde yeni version yaratır.

## Cayma bildirimi

E-posta/adres üzerinden cayma bildirimi legal RC'de mevcuttur. İleride site içi cayma formu eklenirse kullanıcıya bildirimin alındığına ilişkin kalıcı/kanıtlanabilir teyit ve back-office takip akışı ayrıca tasarlanmalıdır. Bu, V1 checkout'un çalışması için yeni özellik olarak zorunlu tutulmaz; mevcut yasal bildirim kanalları doğru çalışmalıdır.

## Site tutarlılığı taraması

Production publish öncesi public storefront şu terimlerle taranmalıdır:

- eski şirket türü veya eski marka/domain/e-posta,
- “7 iş günü” / “10 gün” gibi eski süreler,
- “İkinci El & Outlet” gibi artık **Spot Ürün** olarak standardize edilmesi planlanan müşteri-facing terminoloji,
- kanıtlanmamış “Yetkili Bayi / Yetkili Servis” iddiaları,
- aktif olmayan kargo veya ödeme sağlayıcısının kesinmiş gibi yazılması.

## Yayın sırası

1. Muhasebe/sicil açıklarını kapat.
2. ETBİS ve vendor/privacy blokajlarını kapat.
3. Hukukçu final review.
4. Production legal publish.
5. Legal API/checkout/order acceptance smoke.
6. Gerçek ödeme sağlayıcısı hazırsa kontrollü ödeme fazı.
7. Final V1 QA ve GO LIVE.
