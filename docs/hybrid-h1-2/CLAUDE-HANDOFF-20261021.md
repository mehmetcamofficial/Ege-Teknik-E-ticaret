# H1.2 Claude devir doğrulaması — 2026-10-21

Doğrulanan commit: 6a92756acc5942393cf77693cfc62e733848fdf7 (GitHub uzak SHA ile aynı).

Yeniden çalıştırılan (Codex raporuna güvenilmeden):
- `pnpm typecheck`: hata yok
- `pnpm lint`: 0 hata, 5 önceden var olan uyarı
- `pnpm test`: 1648 test, 1571 geçti, 0 başarısız, 77 atlandı
- `pnpm build`: başarılı
- `scripts/test-hybrid-h12.mjs`: Chrome/Firefox/WebKit × 320/390/768/1024/1440 = 15/15 PASS (90 axe taraması, sipariş oluşturulmadı)
- `scripts/test-hybrid-h12-card.mjs`: 15/15 PASS, 15 axe, en düşük render kontrastı 5,124:1
- gitleaks: sızıntı yok

Not: `.scratch/h12/card-deployments.json` mevcut değildi; Vercel Preview doğrulaması bu belgede yer almaz.
Sınırlama: yerel statik HTTPS sunucu kullanıldı (yazma istekleri 405), gerçek API/ödeme çalışmadı.
Navigasyon: native MPA; "Sayfa açılıyor…" durum hapı + `main` üzerinde 200 ms / 8 px giriş animasyonu. `pagereveal` geçişi kasıtlı kapalı. Görsel kabul kullanıcıya aittir.
