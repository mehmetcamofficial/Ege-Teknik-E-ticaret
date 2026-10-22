# Sipariş anında saklanan hukuki kabul kanıtları (H4-A)

Kaynak: `db/schema.ts`, `lib/legal-evidence.ts`, `lib/legal-evidence-db.ts`, `drizzle-pg/0015_immutable_legal_evidence.sql`, `lib/legal-preview-binding.ts`.
Bu belge kodun ne sakladığını anlatır; hukuki yeterliliği değerlendirmez.

## Saklanan alanlar
- `orders`: `order_issued_at`, `legal_evidence_version` (kalıcılık biçimi 1), `request_fingerprint`, `idempotency_key`.
- `order_legal_acceptances` (her zorunlu belge için bir satır): `document_version_id` (yayınlanmış sürüme FK), `slug`, `title`, `version`,
  `template_content_hash`, **`rendered_body`** (müşterinin gördüğü sipariş-özel tam metin), `rendered_sha256`, `render_context_version`, `acceptance_type`, `accepted_at`.
- Kohort kuralı: eski siparişlerde tüm kanıt alanları NULL, yeni siparişlerde tümü dolu ve `slug ∈ {{distance-sales, pre-information}}` (CHECK kısıtı).

## Bütünlük korumaları (veritabanı)
- `legal_acceptance_no_mutation`: kabul satırları güncellenemez/silinemez.
- `p3_legal_evidence_no_truncate`, `p3_order_identity_guard`, `legal_evidence_source_lock`: toplu silme, sipariş kimliği değişimi ve kaynak sürüm kilidi.
- `p3_order_evidence_complete` / `p3_acceptance_evidence_complete_trg` (deferred constraint trigger): kanıtsız sipariş commit edilemez.
- Bu fonksiyonların ACL'i (PUBLIC EXECUTE revoke, SECURITY INVOKER/DEFINER, güvenli search_path) bağımsız ACL kapısıyla kontrol edilir (H4-C).

## Önizleme → sipariş bağlaması
1. `POST /api/checkout/legal-preview`: sunucu belgeleri sipariş bağlamıyla işler ve imzalı, kısa ömürlü jeton üretir.
2. `POST /api/orders`: jeton, bağlam özeti ve belge sürüm kimlikleri yeniden doğrulanır; kabul edilen kimlikler **önizlemedeki** kimliklerle birebir eşleşmelidir.
3. Fixture kimlikleri (`p2-preview-fixture-*`) bu adımda reddedilir: fixture ile gerçek sipariş oluşmaz.
4. Sepet/alan değişirse istemci önizlemeyi ve kutuları geçersiz kılar (H3); sunucu bağlamı zaten yeniden doğrular.

## Kabul edilen belgelerin müşteriye gösterilmesi
Onay ekranı ve sipariş görüntüleme, kabul edilen **tam sürümü** `/legal/[slug]?version=<id>` bağlantısıyla gösterir.

## Açık noktalar (hukuk)
- Saklama süresi ve silme matrisi tanımsız (VERIFICATION **G1**).
- `rendered_body` kişisel veri içerir (ad, adres, telefon): saklama gerekçesi ve süresi KVKK saklama politikasında yer almalıdır.
