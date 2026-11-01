# Hukuk / işletme onay kontrol listesi (H4-A)

Kutular **bilerek boştur**: işaretleme yetkisi yalnızca ilgili insan sorumludadır. Teknik test sonucu hiçbir kutuyu işaretlemez.
Kısaltmalar: **AV** hukukçu/KVKK danışmanı · **MM** mali müşavir · **İŞ** işletme sahibi · **TEK** teknik.
Her onay, `inventory.json` içindeki dosya **SHA-256** değerine verilmelidir; metin değişirse onay geçersizdir.

## 1. Belge incelemesi (AV)
| Belge | İncelenen SHA-256 (ilk 12) | Onay | Not/Tarih/İmza |
|---|---|---|---|
| distance-sales | `cb319b88f528` | ☐ | |
| pre-information | `b37bef80ac9a` | ☐ | |
| kvkk | **YENİ HASH GEREKLİ** (tekrar satırları düzeltildi) | ☐ | |
| privacy | `d413ab20e7dc` | ☐ | |
| cookies | `6907123cbf77` | ☐ | |
| delivery-returns | `18194bdf5c26` | ☐ | |
| terms | `24a7541112db` | ☐ | |
| installation / warranty / marketing-consent (yayın yolu yok; yayınlanacak mı?) | `3b5c912d5732` / `0c1b193b7928` / `ee033a69dde5` | ☐ karar | |

## 2. Hukuki sorular (AV) — `VERIFICATION_REQUIRED.md` kodlarıyla
- ☐ G1 saklama ve silme matrisi · ☐ G2–G5, G10 yurt dışı aktarım/DPA (Vercel, Neon, Clerk, Sentry)
- ☐ F5 montaj sonrası cayma istisnası ürün bazında · ☐ B8 VERBİS kayıt/istisna
- ☐ Teslimat taahhüdü "1–7 gün" ifadesinin mesafeli satış mevzuatıyla uyumu
- ☐ "Siparişi Onayla — ödeme yükümlülüğü doğurur" düğme etiketinin, ödeme alınmayan "ödeme sonra teyit" akışında yeterli/doğru olup olmadığı

## 3. İşletme / muhasebe (İŞ, MM)
- ☐ B2 KEP · ☐ B4–B7 e-Arşiv, entegratör, bilanço/çalışan eşikleri · ☐ **C1–C3 ETBİS (BLOCKER)**
- ☐ D1–D3 ödeme yöntemi seçimi ve sözleşmesi · ☐ E1–E4 taşıyıcı, tarife, şikâyet/iade yanıt akışı
- ☐ F2–F4 standart dışı iş tarifesi, GREE/TLC yetki belgesi, ürün bazlı garanti
- ☐ Sipariş bildirimi: müşteriye hangi kanal/kim/ne zaman (bkz. `docs/h4/order-operations.md`)

## 4. Teknik yayın adımları (TEK) — yalnızca yukarıdakiler onaylandıktan sonra
1. ☐ Production DB'de fixture satırı OLMADIĞINI salt-okunur denetimle doğrula (`legalFixtureContaminated` false).
2. ☐ Onaylı metinleri admin panelinden **owner** hesabıyla taslak olarak gir; içerik özetini onaylı SHA ile karşılaştır.
3. ☐ Açık yürürlük tarihiyle yayınla (`LEGAL_VERSION_PUBLISHED` denetim kaydını doğrula).
4. ☐ `GET /api/legal/required` yanıtının yayınlanan sürüm kimliklerini döndürdüğünü doğrula.
5. ☐ Disposable ortamda checkout kabul + `order_legal_acceptances` kanıt testi; Production smoke testi.

## 5. İmza
| Rol | Ad | Tarih | İmza |
|---|---|---|---|
| AV | | | |
| MM | | | |
| İŞ | | | |
| TEK | | | |


## 6. Teknik ön inceleme — 2026-11-02 (onay değildir)

Durum: **REVIEW REQUIRED / PRODUCTION PUBLISH BLOCKED**. Bu not hukukçu veya işletme onayı oluşturmaz; bütün onay kutuları boş kalır.

| Kontrol | Gözlem | Kapanış kanıtı |
|---|---|---|
| Checkout hukuki sürüm kaydı | Production `legal_documents` ve `legal_document_versions` envanterleri 0 kayıt; `/api/legal/required` 503 | Owner yetkisiyle yalnız onaylı sürümler yayınlandıktan sonra API 200 ve sürüm ID doğrulaması |
| Şirket ve iade adresi | RC belgeleri Cumhuriyet Mah. Ant Sk. No:7 B; farklı oda/eski kod kayıtlarında İkiçeşmelik Mah. No:13/1D | Güncel şirket sicili/vergi levhası ve gerçek iade adresi işletme tarafından yazılı teyit edilmeli |
| Mesafeli satış | §6'da `[DOĞRULAMA BEKLİYOR: standart montaj paketi kapsamı]` işareti var | Gerçek GREE/TLC standardı, 4 metre kapsamı ve ek iş fiyat politikası yetkili işletme/hukukçu tarafından teyit edilmeli; müşteri metninden iç not çıkarılmalı |
| Ön bilgilendirme | 1–7 gün taahhüdü, ödeme yöntemi ve taşıyıcı koşulları taslakta; fiili Production operasyonuna uygunluk onaylanmadı | Ödeme ve teslimat operasyonu, şikâyet/iade sorumlusu, doğru checkout düğme metni teyidi |
| KVKK | Yinelenen VKN/MERSİS satırları ayrı dalda kaldırıldı; değişen metnin eski checklist hash'i geçersiz | Yeni içerik SHA-256 ve `inventory.json` yeniden hesaplanmalı; veri işleme/aktarım, saklama ve VERBİS hukukçu incelemesi |
| Dinamik hukuki alanlar | Mesafeli satış ve ön bilgilendirmedeki `{{...}}` değişkenleri `LEGAL_TEMPLATE_TOKENS` beyaz listesinde tanımlı; yalnız kaynak-kod kontrolü | İzole DB'de gerçek render ve kabul regresyonu; Production sipariş oluşturma yapılmadan smoke |
| ETBİS | Şirket yetkilisi kaydı henüz tamamlamadı | Şirket/domain ETBİS kayıt kanıtı |

**Yayın disiplini:** Bu denetim Production'a yazma, hukuki sürüm yayınlama, release onayı veya checkout açma yetkisi vermez. `kvkk.md` içeriği değiştiği için önceki `inventory.json` ve eski hash değerine dayanarak onay verilemez.
