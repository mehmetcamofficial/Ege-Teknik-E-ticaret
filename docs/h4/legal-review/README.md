# H4-A — Hukuki hazırlık paketi

Amaç: hukukçu ve işletme sahibinin Production öncesi neyi incelemesi/onaylaması gerektiğini tek yerde toplamak.
**Bu pakette hukuki metin yazılmadı, hiçbir belge yayınlanmadı veya geçerli işaretlenmedi, veritabanına yazılmadı.**

| Dosya | İçerik |
|---|---|
| `document-inventory.md` | 10 belge: kaynak, slug, durum, kabul gereksinimi, ekran, özet; Preview gözlemi; fixture korumaları |
| `missing-fields.md` | Açık/bekleyen maddeler ile doğrulanmış bilgilerin ayrı listesi |
| `acceptance-evidence.md` | Sipariş anında saklanan kabul kanıtları ve DB korumaları |
| `approval-checklist.md` | İnsan onay kontrol listesi (boş) |
| `inventory.json`, `preview-observation.json` | Makine okunur envanter; Preview GET gözlemi (fixture sınıflaması) |

Yeniden üretim: `node scripts/h4-legal-inventory.mjs`.

**Durum: hukuki geçerlilik BLOCKED** (insan/hukuk onayı yok; Preview'da yalnızca fixture var; Production durumu gözlenemez).
