# Ege Teknik — Kârlılık + AI Gateway (Draft PR)

## Bölüm
Super-admin: `/admin/finance/profitability`.

This PR provides a **manual scenario calculator**. It does not save purchase
costs to Neon, and does not read supplier prices from the database.

## Preview-only environment variables

```env
EGE_AI_ENABLED=false
AI_GATEWAY_MODEL=
# AI_GATEWAY_API_KEY stored as secret in Vercel, never in Git or browser
```

After verification, choose a live `provider/model` ID from
https://ai-gateway.vercel.sh/v1/models, configure a project/API-key
spending limit and update **Preview** only:

```env
EGE_AI_ENABLED=true
AI_GATEWAY_MODEL=provider/model-from-live-catalog
```

Do not set Production AI variables before explicit approval.

## Safety notes
- API GET and POST require the non-grantable `payments:configure` permission
  and `super_admin` role.
- AI question is limited to 1000 characters. Neither stored product costs
  nor automatically collected client data are sent to Gateway.
- AI output is informational. Price, product, stock and payment mutation
  APIs are not exposed.
- The Gateway key stays server-side.
- Input token/response limits and a 15s timeout are not a hard spend limit.
  Configure the actual budget in Vercel and verify Preview quota controls.
- Active database-backed limits: 10 requests/hour per caller IP and 100 requests/month globally (UTC calendar month); these are request ceilings, not monetary budgets.
- The per-IP limiter does not establish per-admin-user quotas. Consider authenticated-user quotas before enabling for multiple super-admins.
- A confidential cost table requires separate storefront/admin DB users,
  ACL verification and a migration review. The existing shared DATABASE_URL
  is **not** acceptable evidence of cost-data separation.

## CI checks (before merge)
```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Review route protection and Preview smoke tests, then merge only after
the reviewer confirms Production is unaffected.
