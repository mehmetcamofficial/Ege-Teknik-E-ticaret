# Hukuki belge envanteri (H4-A)

> **Bu belge hukuki metin değildir ve hiçbir belgenin geçerli veya yayınlanmış olduğunu göstermez.**
> Envanter yalnızca depodaki Release Candidate (RC) dosyalarından ve kod kayıt defterlerinden üretilmiştir
> (`scripts/h4-legal-inventory.mjs`, veritabanı okumaz). Hukuki geçerlilik ayrı insan/hukuk onayıdır: **BLOCKED**.

## 1. Belgeler, kaynakları ve durumları

| RC dosyası | Belge | DB slug | RC başlık durumu | Kabul gereksinimi | Sipariş alanları | Kelime | SHA-256 (ilk 12) |
|---|---|---|---|---|---|---|---|
| `distance-sales.md` | Mesafeli Satış Sözleşmesi | `distance-sales` | RELEASE CANDIDATE — LEGAL REVIEW REQUIRED · NO | checkbox (required, version id recorded) | 13 sipariş alanı | 1296 | `cb319b88f528` |
| `pre-information.md` | Ön Bilgilendirme Formu | `pre-information` | RELEASE CANDIDATE — LEGAL REVIEW REQUIRED · NO | checkbox (required, version id recorded) | 8 sipariş alanı | 1154 | `b37bef80ac9a` |
| `kvkk.md` | KVKK Aydınlatma Metni | `kvkk` | RELEASE CANDIDATE — LEGAL REVIEW REQUIRED · NO | notice only (must be published; never a checkbox) | — | 1427 | `93ef244ffd8d` |
| `privacy.md` | Gizlilik Politikası | `privacy` | RELEASE CANDIDATE — LEGAL REVIEW REQUIRED · NO | none | — | 902 | `d413ab20e7dc` |
| `cookies.md` | Çerez ve Tarayıcı Depolama Bilgilendirmesi | `cookies` | RELEASE CANDIDATE — LEGAL REVIEW REQUIRED · NO | none | — | 887 | `6907123cbf77` |
| `delivery-returns.md` | Teslimat, Montaj, İade ve Cayma Koşulları | `delivery-returns` | RELEASE CANDIDATE — LEGAL REVIEW REQUIRED · NO | none | — | 1126 | `18194bdf5c26` |
| `terms.md` | İnternet Sitesi Kullanım Koşulları | `terms` | RELEASE CANDIDATE — LEGAL REVIEW REQUIRED · NO | none | — | 1001 | `24a7541112db` |
| `installation.md` | Kurulum ve Montaj Bilgilendirmesi | `—` | RELEASE CANDIDATE — LEGAL REVIEW REQUIRED · NO | none | — | 1051 | `3b5c912d5732` |
| `marketing-consent.md` | Ticari Elektronik İleti (Pazarlama) İzni | `—` | DRAFT — LEGAL REVIEW REQUIRED · NOT PUBLISHED  | none | 2 sipariş alanı | 397 | `ee033a69dde5` |
| `warranty.md` | Garanti Bilgilendirme Modeli | `—` | DRAFT — LEGAL REVIEW REQUIRED · NOT PUBLISHED  | none | 10 sipariş alanı | 406 | `0c1b193b7928` |

Tam SHA-256 değerleri ve sipariş alanı adları: `inventory.json`. İnceleme sırasında dosya değişirse özet değişir; hukukçu onayı hangi özete verildiğini kaydetmelidir.

Taslak/yayın durumu notu: RC dosyaları **yayınlanmış değildir** (depodaki markdown, Production'da yayın demek değildir).
Gerçek yayın durumu yalnızca veritabanında (`legal_document_versions.published_at/published_by/effective_at`) bulunur.
Bu görevde Production veritabanı okunmadı ve okunmamalıdır → **Production yayın durumu: BİLİNMİYOR (BLOCKED)**.

## 2. Hangi belge hangi ekranda kullanılıyor

| Belge | Kullanıldığı yer |
|---|---|
| Mesafeli Satış Sözleşmesi | Checkout: zorunlu kabul kutusu (sürüm kimliğiyle kaydedilir), sipariş önizlemesi, onay ekranı, /legal/[slug] |
| Ön Bilgilendirme Formu | Checkout: zorunlu kabul kutusu (sürüm kimliğiyle kaydedilir), sipariş önizlemesi, onay ekranı, /legal/[slug] |
| KVKK Aydınlatma Metni | Checkout: bilgilendirme bağlantısı (kutu değil); yayınlanmadan sipariş alınmaz; /legal/[slug] |
| Gizlilik Politikası | Yalnızca /legal dizini ve /legal/[slug] |
| Çerez ve Tarayıcı Depolama Bilgilendirmesi | Çerez bildirimi "Ayrıntılı bilgi" bağlantısı policies.html#privacy’e gider; /legal dizini |
| Teslimat, Montaj, İade ve Cayma Koşulları | Yalnızca /legal dizini ve /legal/[slug] |
| İnternet Sitesi Kullanım Koşulları | Yalnızca /legal dizini ve /legal/[slug] |
| Kurulum ve Montaj Bilgilendirmesi | Admin dilim listesinde YOK; yayın yolu tanımlı değil |
| Ticari Elektronik İleti (Pazarlama) İzni | Özellik KAPALI; admin dilim listesinde YOK |
| Garanti Bilgilendirme Modeli | Model taslağı; admin dilim listesinde YOK |

`installation`, `marketing-consent` ve `warranty` belgeleri `LEGAL_DOCUMENT_SLUGS` içinde olmadığından admin panelinden taslak bile oluşturulamaz;
bu üç belge için yayın yolu yoktur (karar: hukuk/işletme; kod değişikliği gerektirir).

## 3. Preview'da gözlenen durum (salt okunur GET, 2026-10-22)

`GET /api/legal/documents` ve `GET /api/legal/required` yanıtlarının tamamı (gövde yok, yalnızca slug/başlık/sürüm kimliği):

| Slug | Başlık | Sürüm kimliği | Kayıt defteri sınıfı |
|---|---|---|---|
| cookies | DRAFT — PHASE 3B.3 ADMIN TEST — LEGAL REVIEW REQUIRED (v2) | `f62b7e17-98dc-48e4-8630-c2fffbfe6fa8` | legacy_fixture |
| distance-sales | PREVIEW TEST — distance-sales | `preview-test-ver-distance-sales-2` | legacy_fixture |
| kvkk | PREVIEW TEST — kvkk — NOT LEGAL TEXT — DO NOT COPY TO PRODUC | `c58b9077-dd52-4f32-bf3f-1dca51ba471e` | legacy_fixture |
| pre-information | PREVIEW TEST — pre-information | `preview-test-ver-pre-information-2` | legacy_fixture |
| distance-sales | PREVIEW RENDER TEST — NOT LEGAL TEXT | `p2-preview-fixture-distance-sales-render-1` | reserved_preview_fixture |
| pre-information | PREVIEW RENDER TEST — NOT LEGAL TEXT | `p2-preview-fixture-pre-information-render-1` | reserved_preview_fixture |

**Sonuç: gözlenen altı kaydın altısı da koddaki fixture kayıt defterinde (`lib/legal-fixture-registry.ts`) yer alır.**
Preview'da gerçek yayınlanmış hiçbir hukuki belge yoktur. Bu kayıtlar gerçek hukuki belge sayılmaz ve sayılmamalıdır.

## 4. Fixture'ların Production'a sızmasını engelleyen mevcut korumalar (kod okuması)

- `legalFixtureContaminated` (lib/legal-db.ts): doğrulanmış Preview kimliği dışında, kayıt defterindeki herhangi bir fixture sürüm kimliği veritabanında bulunursa
  `/api/legal/documents` boş döner ve checkout `LEGAL_DOCUMENTS_UNAVAILABLE` ile kapanır (fail-closed).
- Ayrılmış `p2-preview-fixture-*` belgeleri yalnızca `reservedPreviewCheckoutDocuments` kapısından, tam doğrulanmış Preview kimliğiyle sunulur;
  sipariş bağlaması (`lib/legal-preview-binding.ts`) bu kimlikleri reddeder, yani fixture ile **gerçek sipariş tamamlanamaz**.
- Yayın: yalnızca `legal:write` yetkisi (yalnızca OWNER), tek transaction, `LEGAL_VERSION_PUBLISHED` denetim kaydı; otomatik yayın yoktur.
- Bu koruma kod incelemesi ve mevcut testlerdir; H4-C'de yeniden çalıştırılan sonuçlar `docs/h4/db-security-verification.md` içindedir.

## 5. Eski kimlik taraması

Depoda (`public/`, `app/`, `lib/`, `components/`, `data/`) `oncoconnect`, `trendklima`, "şahıs işletmesi", "7 iş günü" ifadeleri bulunmadı (`git grep`, 2026-10-22).
`policies.html` içindeki statik özet metin (1–7 gün teslimat, cayma) RC metinleriyle aynı yöndedir; ancak **sürümlenmeyen ikinci bir kopyadır** ve RC değiştiğinde elle güncellenmelidir (risk).
