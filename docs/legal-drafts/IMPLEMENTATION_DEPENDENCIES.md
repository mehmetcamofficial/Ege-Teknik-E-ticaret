> **DRAFT — LEGAL REVIEW REQUIRED · NOT PUBLISHED · NOT PRODUCTION LEGAL TEXT**

# Yayından Önce Uygulamada Gerekenler (yalnızca not; bu fazda uygulanmadı)

## Bilinen çalışma zamanı boşlukları (Production satışından önce çözülmelidir)

1. **Ödenecek toplam ve ek masraflar:** Checkout bugün kargo/montajın sonradan netleşeceğini söylüyor ("Keşifte netleşir"). Production satışından önce müşteriye gösterilen
   ödenecek toplam ve uygulanacak ek masrafların (teslimat, seçilmişse kurulum) **mevzuata uygun, sipariş öncesi kesinleştirilen** bir akışla sunulması gerekir.
2. **KVKK aydınlatması:** İlgili veri toplama formlarında (sipariş, iletişim/servis, ikinci el rezervasyonu, hesap profili) henüz yer almıyor; yerleştirilmesi gerekir (onay kutusu olarak değil).
3. **Pazarlama izni:** SMS/e-posta/WhatsApp için ayrı, isteğe bağlı, işaretsiz, geri alınabilir ve satın almadan bağımsız kendi mekanizmasını (kayıt, İYS uyumu) gerektirir.
4. **Saklama/silme:** Saklama süresi politikası ve silme/anonimleştirme uygulaması çözülmemiştir; bugün uygulamada temizleme işi yoktur.
5. **Preview test belgeleri:** Preview'daki test hukuki belgeleri (`PREVIEW TEST`, `PHASE 3B.3 …`, `terms`/`cookies` test geçmişi) **hiçbir koşulda Production'a kopyalanmaz/tohumlanmaz.**
6. **Yayın önkoşulu:** Bu taslaklar, şirket kimliği doğrulaması ([VERIFICATION_REQUIRED.md](VERIFICATION_REQUIRED.md)) ve hukuki inceleme tamamlanmadan **yayınlanmamalıdır**.

## Ayrıntılı liste

Bu liste taslakların "gerçek" olabilmesi için mevcut uygulamada eksik olan işleri gösterir. Hiçbiri bu fazda yapılmamıştır.

1. **Toplam fiyat / teslimat bedeli:** Checkout Phase 3.4 ile klimada teslimat + standart montajı ürün fiyatına dâhil, kargoyu yalnızca parça için opsiyonel/ücretli sunar (kargo tarifesi henüz `pending`); ilgili hukuki metinler teknik olarak uyarlanmıştır, hukuki onay yoktur; ön bilgi m.5/1-(d) tüm vergiler ve nakliye dâhil toplam fiyatı ister. Teslimat ücreti hesaplanmalı ve sipariş özetinde gösterilmeli (C3).
2. **Ön bilginin gösterimi (m.6/2-a, m.7, m.8):** (a),(d),(g),(h) bilgileri ödeme yükümlülüğünden hemen önce bir bütün olarak, ≥12 punto; ön bilgi teyidi; sipariş butonunda "ödeme yükümlülüğü" ifadesi.
3. **Sipariş-özel alanlar:** `{{...}}` alanlarını dolduran, üretilen sözleşme/ön bilgi görünümünün sipariş kaydıyla saklanması (bugün yalnızca sürüm kimliği ve kabul zamanı saklanıyor; sürüm içeriği değişmez olduğundan sipariş verisiyle birlikte render edilmelidir).
4. **Kurulum seçimi ve ek iş onayı:** kurulum seçeneği önceden işaretsiz; ek iş için ayrı onay kaydı ve ayrı tahsilat akışı (m.19). Bugün yalnızca "survey_then_install / delivery_only" tercihi var.
5. **KVKK bildirimi görünürlüğü:** Sipariş, iletişim/servis formu, ikinci el rezervasyonu ve hesap profilinde aydınlatma bağlantısı (onay kutusu **değil**).
6. **Pazarlama izni:** ayrı, işaretsiz, kanal bazlı UI ve izin kaydı için ayrı veri modeli/İYS entegrasyonu.
7. **Cayma formu/akışı:** sitede cayma bildirim seçeneği sunulacaksa ulaştığına dair anında teyit (m.11/2).
8. **Kayıt saklama ve silme:** en az 3 yıl saklama ve süre sonu silme/anonimleştirme işlerinin tasarlanması (E1).
9. **Site tutarlılığı:** ana sayfa alt bilgisindeki e-posta ve telif satırı (VERIFICATION_REQUIRED H); alt bilgi bağlantılarının yeni belge slug'larına yönlendirilmesi; "Yetkili Bayi" ifadesinin belgeyle doğrulanması.
10. **Üçüncü taraf kaynaklar:** Google Fonts/Tailwind CDN'in kendi sunucumuzdan sunulması (öneri).
11. **Ödeme:** PayTR devreye alınırken ödeme yöntemi metinleri (B1–B2) ve ödeme kuruluşu aydınlatması güncellenmeli.
12. **Yayın yolu:** yalnızca Faz 3B.3 yönetim akışı; Production'a Preview test belgeleri (`PREVIEW TEST`, `PHASE 3B.3 …`, `terms`/`cookies` test geçmişi) taşınmaz.
