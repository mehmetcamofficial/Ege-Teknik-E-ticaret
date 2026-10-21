# Hukuk / işletme onay kontrol listesi (H4-A)

Kutular **bilerek boştur**: işaretleme yetkisi yalnızca ilgili insan sorumludadır. Teknik test sonucu hiçbir kutuyu işaretlemez.
Kısaltmalar: **AV** hukukçu/KVKK danışmanı · **MM** mali müşavir · **İŞ** işletme sahibi · **TEK** teknik.
Her onay, `inventory.json` içindeki dosya **SHA-256** değerine verilmelidir; metin değişirse onay geçersizdir.

## 1. Belge incelemesi (AV)
| Belge | İncelenen SHA-256 (ilk 12) | Onay | Not/Tarih/İmza |
|---|---|---|---|
| distance-sales | `cb319b88f528` | ☐ | |
| pre-information | _inventory.json_ | ☐ | |
| kvkk | _inventory.json_ | ☐ | |
| privacy | _inventory.json_ | ☐ | |
| cookies | _inventory.json_ | ☐ | |
| delivery-returns | _inventory.json_ | ☐ | |
| terms | _inventory.json_ | ☐ | |
| installation / warranty / marketing-consent (yayın yolu yok; yayınlanacak mı?) | _inventory.json_ | ☐ karar | |

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
