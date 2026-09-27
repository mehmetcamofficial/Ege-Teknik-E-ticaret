# Paket 1 audit — 2026-09-28

Base: recovery/vercel-phase3a-2026-09-21 @ 28deb9c9d64cd6616a3f9dc3f3516e1b82528423.
Clean remote checkout; the user's Mac working tree is not accessible here.

| File / surface | Problem / customer impact | Correction |
|---|---|---|
| public/index.html / hero and 3 featured cards | Generated representative product images, hardcoded capacity/features | Use authoritative catalog cards and reviewed model-specific hero asset; remove unsupported fixed claims |
| public/store-core.js / productCard | CSS illustration used when image missing; icon state not announced | Remove invented product illustration, accessible pressed labels, fixed image layout |
| public/catalog.html + store-core.js | Only category, BTU and search; fixed category options | Add data-derived series/energy/Wi-Fi/categories, stock/price filtering, sorting, URL state, mobile disclosure |
| public/store-core.js / product detail | Existing verified gallery/spec/document pipeline available | Preserve it; add accurate per-product description and canonical metadata |
| public/checkout.html | Production and V1 internal terminology | Plain customer language; do not relabel legal test fixtures as real agreements |
| data/catalog-enrichment/catalog-enrichment.v1.json | 87 decisions: 43 ready, 35 limited, 8 asset-blocked, 1 conflict-blocked | Reuse reviewed mapping; never invent missing data. 78 records do not prove live DB enrichment |
| CSP screenshot | blocked resources and eval shown, but no blocked URL/stack/directive detail | Diagnose from production-mode browser where possible. Never weaken policy with unsafe-eval |

Audit limitations before edits: no authenticated Preview browser session or verified database connection in this workspace. Live category/card/detail/mobile checks remain outstanding, not PASS. The existing GET /api/products calls ensureCatalogInitialized and may seed an empty database; avoid live requests until environment and data state are known.
