> **DRAFT — LEGAL REVIEW REQUIRED · NOT PUBLISHED · NOT PRODUCTION LEGAL TEXT**
> Bu taslak, 3B.4 denetiminde kodda fiilen bulunan depolama/çerez kullanımını yansıtır. Bulunmayan analitik/pazarlama çerezi **iddia edilmemiştir**.

# ÇEREZ VE TARAYICI DEPOLAMA BİLGİLENDİRMESİ

## 1. Özet

Ege Teknik sitesi **analitik veya pazarlama/reklam çerezi kullanmamaktadır**; çerez onay bandı/yönetimi bulunmamaktadır (yayın anındaki durum
yeniden doğrulanmalıdır). Aşağıdaki tablo, sitenin çalışması için kullanılan zorunlu/işlevsel depolamayı gösterir.

## 2. Çerezler (HTTP cookie)

| Ad | Kimde / nerede | Amaç | Tür | Süre |
|---|---|---|---|---|
| `ege_admin_session` | yalnızca işletme yönetim paneline giriş yapan yetkili kullanıcılar; ziyaretçilere/müşterilere **verilmez** | yönetici oturumu (HttpOnly, SameSite=Strict) | Zorunlu / oturum | en çok 8 saat, düzenli yenilenir |
| Clerk oturum çerezleri | müşteri hesabı sayfalarında (`/account`) giriş yapıldığında/giriş sayfasına gidildiğinde | kimlik doğrulama ve oturum | Zorunlu (hesap özelliği için) | [DOĞRULAMA BEKLİYOR: Clerk çerez listesi ve süreleri] |

## 3. Tarayıcı depolaması (çerez **değildir**)

| Anahtar | Depolama | Amaç | Tür | Silme |
|---|---|---|---|---|
| `ege-cart` | localStorage | sepet içeriği (ürün kimliği ve adet) | İşlevsel / talep edilen hizmet için gerekli | tarayıcı verisini silerek veya sepetten çıkararak |
| `ege-favorites` | localStorage | favori ürünler | İşlevsel | aynı |
| `ege-compare` | localStorage | karşılaştırma listesi | İşlevsel | aynı |
| `ege-order-attempt` | sessionStorage | çift sipariş oluşmasını önleyen tek seferlik anahtar | Zorunlu / oturum | sekme kapanınca |
| `ege-service-attempt` | sessionStorage | çift talep gönderimini önleyen anahtar | Zorunlu / oturum | sekme kapanınca |

Bu veriler cihazınızda kalır, Ege Teknik sunucularına profil oluşturmak için gönderilmez.

## 4. Üçüncü taraf kaynaklar

Sayfalar; yazı tipleri (Google Fonts), stil aracı (Tailwind CDN) ve Google tarafından barındırılan bazı görseller gibi dış kaynakları yükleyebilir. Bu istekler
IP adresinizin ilgili sağlayıcıya iletilmesine yol açar; bu kaynakların çerez bırakıp bırakmadığı bu taslakta doğrulanmamıştır. *(Öneri: ilerleyen aşamada kaynakların kendi
sunucumuzdan sunulması.)* Hata izleme (Sentry) yönetim/hesap sayfalarında teknik hata bilgisi toplayabilir.

## 5. Tercihleriniz

Zorunlu depolama kapatılırsa sepet ve hesap girişi çalışmayabilir. Tarayıcı ayarlarınızdan çerezleri ve site verilerini silebilirsiniz.

## 6. Gelecekteki değişiklik

Analitik, reklam veya benzeri **zorunlu olmayan** çerez/izleyici eklenmesi hâlinde: önce bu metin güncellenmeli ve **ayrı bir çerez onay yönetimi** (varsayılan kapalı, reddetmesi kabul kadar kolay,
kayıt altına alan) devreye alınmalıdır. Bu çalışma ayrı bir uygulama maddesidir.

> **İnceleme notu:** Bugünkü zorunlu/işlevsel depolama için onay bandı gerekip gerekmediği ve Google Fonts/CDN isteklerinin aydınlatma/aktarım açısından nasıl ele alınacağı hukuki incelemeye tabidir.
