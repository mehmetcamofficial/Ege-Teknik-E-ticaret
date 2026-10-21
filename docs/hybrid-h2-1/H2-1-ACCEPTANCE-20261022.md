# H2.1 — Son görsel rötuşlar kabul kaydı (2026-10-22)

Branch `feature/hybrid-h2-1-final-polish`, H2 `8311475` üzerinden. Uygulama kodu: `1437d89` (uygulama dosyaları `c425c64` ile aynı).
Preview `dpl_CD49Us8FcF8dBaezQCpX4mqov6zu` (Ready, preview).

| Commit | İçerik |
|---|---|
| d7f5cd4 | Mobil kart: %40 görsel sütunu, yeşil-gri zemin, büyük ürün; masaüstü/tablet görsel alanı 16:10 |
| 8be0bff | Mobil ürün: kompakt galeri, fiyat/stok/satın alma ilk ekranda |
| a9d2940 | Yardım butonu fiyat, stok, satın alma kontrolleri ve sabit çubukla çakışınca kenara çekilir; panel/menü/drawer/çerez açıkken gizli |
| c425c64 | Geç görsel yüklemelerinde çakışma kontrolü |
| 1437d89 + son | Test zamanlama düzeltmeleri, kanıtlar |

Sonuçlar: hosted H2 15/15 (84 axe, min kontrast 5,58:1, 159 yardım çakışma kontrolü, 15/15 yardım klavye kontrolü),
hosted H1.2 regresyonu 15/15, yerel H2 15/15, yerel H1.2 regresyonu 15/15, birim testleri 1587/0, tsc/lint/build/gitleaks temiz.
POST'lar test tarafından yanıtlandı, sipariş oluşturulmadı. Önce/sonra: `comparison/`.
