# H5-B — İzin matrisi (koddan üretilmiştir)

Kaynak: `lib/security-policy.ts` · yeniden üretim: `node --experimental-strip-types scripts/h5-rbac-matrix.mjs`

## Roller × izinler (● = rol kendi başına taşır)

| Rol | admin:read | audit:read | catalog:write | content:write | integrations:read | integrations:write | legal:write | orders:write | payments:configure | payments:record | payments:refund | roles:write | security:write | service:write | users:read | users:write |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Süper Yönetici (`super_admin`) | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| Yönetici (`admin`) | ● |  | ● | ● |  |  |  | ● |  |  |  |  |  | ● |  |  |
| Sahip (emekli, atanamaz) (`owner`) | ● |  | ● | ● |  |  | ● | ● |  |  |  |  |  | ● |  |  |
| Operasyon Yöneticisi (`operations_manager`) | ● |  | ● |  |  |  |  | ● |  |  |  |  |  | ● |  |  |
| Katalog Yöneticisi (`catalog_manager`) | ● |  | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |
| Destek Uzmanı (`support_agent`) | ● |  |  |  |  |  |  | ● |  |  |  |  |  | ● |  |  |
| Finans Sorumlusu (YENİ) (`finance_manager`) | ● |  |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |
| İzleyici (`viewer`) | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

## Sipariş durumu geçişi için gereken izin

| Hedef durum | Gereken izin |
|---|---|
| `pending_payment` | `orders:write` |
| `paid` | `payments:record` + defterde toplam tutarın tamamını kapsayan tahsilat |
| `preparing` | `orders:write` |
| `shipped` | `orders:write` |
| `delivery` | `orders:write` |
| `delivered` | `orders:write` |
| `installation` | `orders:write` |
| `completed` | `orders:write` |
| `cancelled` | `orders:write` |
| `returned` | `orders:write` |
| `service` | `orders:write` |

## Süreli yetki tavanları (saat)

| İzin | En fazla |
|---|---|
| `payments:record` | 24 |
| `payments:refund` | 24 |
| `orders:write` | 168 |
| `users:write` | 24 |
| `payments:configure` | verilemez |
