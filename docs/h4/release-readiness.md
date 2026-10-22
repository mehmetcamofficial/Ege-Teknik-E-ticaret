# H4 — Production yayın hazırlığı kararı (2026-10-22)

## Karar: **NO-GO**

Kod ve test kapıları temizdir; ancak aşağıdaki **engelleyiciler** kodla çözülemez veya bu görevin yetkisi dışındadır
(hukuki yayın, Production yapılandırması/migration, işletme kararları). Hiçbir engelleyici "test geçti" diye gevşetilmedi.

## 1. Çalıştırılan kapılar (hepsi bu görevde)

| Kapı | Sonuç |
|---|---|
| TypeScript / ESLint (0 hata, eski 5 uyarı) / build / gitleaks (dal farkı, docs, scripts) | PASS |
| Birim testleri | **1619 geçti, 0 başarısız, 77 atlandı** (atlananlar DB gerektirir; aşağıda gerçek PG ile koşuldu) |
| Disposable PostgreSQL 18.6: postgres 22/22, legal 19/19, ACL 63/63, commerce 38/38, http-checkout PASS, H4 HTTP (12 geçersiz girdi, 8 eşzamanlı sipariş→3, 6 aynı-anahtar→1 sipariş, tutar/KDV/ödeme tutarlılığı), yedek birim 21/21, sentetik yedek→restore 44 tablo 0 fark, eksik-rol restore atomik reddi + OWNER/ACL korunumu | PASS (`db-security-verification.md`) |
| **Hosted Preview** (`dpl_8Vrh4TideNBHBrKLp2G18rB7N9Qw`, preview, Ready): H3.1 15/15, H3 15/15, H2/H2.1 15/15, H1.2 15/15 (Chrome/Firefox/WebKit × 320/390/768/1024/1440; 324 axe taraması, hata yok) | PASS |
| Hosted salt-okunur yayın kapıları 9/9: sağlık (`environment: preview`, Preview Neon dalı ≠ Production), yönetici API'leri anonim → 403, yönetici sayfaları → 307, güvenlik başlıkları (CSP, nosniff, referrer, HSTS), noindex, ödeme sağlayıcısı görünmez, `.env`/kaynak haritası sunulmaz, sipariş uç noktaları GET'e kapalı | PASS (`evidence/hosted/release-gates.json`) |
| Gerçek sipariş oluşturma / Preview'a POST | **Yapılmadı** (tüm yazma istekleri test tarafından yakalandı: 195 yakalanan POST, 0 gerçek) |
| Yönetici paneli oturumlu regresyon (hosted) | **BLOCKED**: admin kimlik bilgisi/oturumu yok; yalnızca anonim reddi ve birim/gerçek-PG testleri koşuldu |

## 2. Production engelleyicileri

### Hukuki (insan/hukuk onayı) — BLOCKED
1. Gerçek, onaylı **mesafeli satış**, **ön bilgilendirme** ve **KVKK aydınlatma** metinleri yayınlı değil. Preview'da gözlenen 6 kaydın 6'sı fixture; RC metinleri yayınlanmamış taslaktır (`legal-review/`). Production yayın durumu gözlenemedi.
2. Hukuki sorular açık: saklama/silme matrisi (G1), yurt dışı aktarım (Vercel/Neon/Clerk/Sentry), montaj sonrası cayma (F5), VERBİS (B8), düğme etiketinin "ödeme sonra teyit" akışına uygunluğu.
3. **ETBİS kaydı (C1, işaretli BLOCKER)** ve KEP (B2) doğrulanmadı.

### Production yapılandırması / veritabanı — BLOCKED (bu görevde yasak)
4. **`LEGAL_PREVIEW_SIGNING_SECRET` Production hedefinde tanımlı değil.** Kod her checkout önizlemesinde bunu zorunlu tutar (`lib/legal-preview-token.ts`); yokken hukuki önizleme ve sipariş **kapalı kalır (fail-closed)**. Ayrıca `docs/operations/environment-contract.md` bu değişkeni listelemez (belge eksiği). Kanıt: `evidence/vercel-env-names.json` (yalnızca ad/hedef).
5. **Migration 0013–0021 Production'da yok** (migration betiği yalnızca 0000–0012'yi Production'da uygulanmış sayar). Değişmez kanıt, kapsamlı checkout, KVKK/legal korumaları bunlara dayanır. Production migration ayrı, onaylı bir adımdır.
6. Kapsamlı checkout DB ayrımı (`CHECKOUT_SCOPED_DB_ENABLED`, `STOREFRONT_/ADMIN_DATABASE_URL`) yalnızca Preview'da tanımlı; Production eski (owner rolü) yolunu kullanır. Karar ve gerçek-ortam doğrulaması gerekir.
7. `RESEND_API_KEY` / `MAIL_FROM` Production'da yok: yönetici daveti/şifre sıfırlama e-postası gönderilemez (müşteri bildirimi zaten yok).
8. Üretim ortamı için doğrulanmış `EXPECTED_NEON_PRODUCTION_BRANCH_ID` ve `APP_ENV` mevcut (ad düzeyinde); değerler doğrulanmadı.

### Operasyon — BLOCKED (işletme kararı)
9. **Zamanlanmış Production yedeği etkin değil:** `main` dalında `.github/workflows` yok; PR #23 ve PR #3 açık. Gerçek Production arşivinden restore tatbikatı ve RTO/RPO bu görevde yapılamadı.
10. **Müşteri bildirimi yok (manuel):** sipariş sonrası e-posta/SMS gönderilmez; yönetici uyarısı/sayaç yok → siparişler gözden kaçabilir (R1/R3). Ödeme sağlayıcısı yok; tüm siparişler `pending_payment` kalır.
11. **Görev ayrımı yok (R2):** 5 rol `orders:write` ile ödeme kaydı/iade/"ödendi" yapabilir.
12. Taşıyıcı, kargo/iade tarifesi, standart dışı iş tarifesi, GREE/TLC yetki belgesi, ürün bazlı garanti, şikâyet yanıt akışı (VERIFICATION E, F) işletme tarafından kesinleşmedi.
13. iOS Safari gerçek cihazı ve Production'a yakın yük/performans testi yapılmadı (yalnızca Playwright WebKit).

## 3. Teknik olarak hazır olanlar
- Fixture'ların Production'a sızmasına karşı çok katmanlı koruma (dizin boşaltma + checkout kapanışı + sipariş bağlaması reddi), testlerle doğrulandı.
- Fiyat/KDV/stok sunucuda; eşzamanlı siparişlerde fazla satış yok; idempotency; kanıt değişmezliği (sahip rolü bile silemez).
- Ödemesiz sipariş "ödendi" olamaz; iptal için iade zorunlu; her durum değişikliği denetimli.
- Restore: eksik rolde atomik ret; roller varken OWNER/ACL/SECURITY DEFINER birebir.
- Sepet/checkout erişilebilirlik, çoklu tarayıcı, mobil, reduced-motion regresyonları.

## 4. GO için gereken sıra (öneri)
1. Hukuk: RC metinleri incele/onayla (`legal-review/approval-checklist.md`), ETBİS/KEP kapat.
2. İşletme: bildirim ve sipariş takip prosedürü, ödeme yöntemi, taşıyıcı, rol politikası (R1–R3).
3. Teknik (onayla, ayrı görev): Production'a `LEGAL_PREVIEW_SIGNING_SECRET`, migration 0013–0021 (yedek alındıktan sonra), kapsam DB kararı, PR #23 merge + ilk zamanlanmış yedek doğrulaması.
4. Onaylı metinleri owner ile yayınla → `/api/legal/required` → disposable'da kanıt testi → Production smoke.

Bu belge Production deploy/merge/hukuki yayın/ödeme aktivasyonu izni değildir.
