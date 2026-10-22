# H2 — Premium katalog ve ürün detayı kabul kaydı (2026-10-21)

Branch `feature/hybrid-h2-premium-catalog`, H1.2 `5a28572` üzerinden.
Uygulama SHA: `b120323a8e07616a7665561e9a98f00bffa2c06f` · Preview `dpl_AWfD2LvRn28r5ymmPukuc6gvaDo8` (Ready).

| Aşama | Commit | İçerik |
|---|---|---|
| H2-A | f9d26f0 | Premium kartlar, 4:3 görsel, stok/uygunluk yalnız saleMode+stock'tan, mobil yatay kart |
| H2-B | 0698745 | Renk + uygunluk filtresi, tek değerli filtre gizleme, boş sonuçta sayılı öneriler, mobil çekmece |
| H2-C | 540621a | Seri seçenekleri (her biri kendi API fiyatı), galeri ok butonları, Ürün Bilgileri tablosu |
| H2-D | fc65e1c | Geçiş %55 başlangıç, kompakt mobil çerez bildirimi, sabit satın alma çubuğu atlamada da açılır |
| fix | b120323 | WebKit varsayılan Tab sırasında filtre çekmecesi odak tuzağı |

Sonuçlar: hosted H2 15/15 (84 axe, min kontrast 5,58:1), hosted H1.2 regresyonu 15/15 (fc65e1c üzerinde),
yerel H2 15/15, yerel H1.2 regresyonu 15/15, birim testleri 1585 geçti / 0 başarısız, tsc/lint/build/gitleaks temiz.
Tüm koşularda POST'lar test tarafından yanıtlandı; sipariş oluşturulmadı. Hosted erişim OIDC başlığı ile, değer kaydedilmedi.
Sınır: hosted veride tükenmiş/düşük stoklu online ürün yoktu; bu durumlar yerelde fixture düzenlemesiyle test edildi.
