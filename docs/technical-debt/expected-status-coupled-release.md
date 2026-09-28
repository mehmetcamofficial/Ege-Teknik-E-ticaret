# Release note: order status transition requires `expectedStatus` (UI + API are coupled)

Sprint B made admin order status changes compare-and-set. `PATCH /api/admin/orders/[id]` now **requires** both `status` (the target) and
`expectedStatus` (the status the admin saw); a mismatch returns `409` ("Sipariş durumu başka bir işlem tarafından değiştirildi; sayfayı yenileyin.") and changes nothing.

## What is coupled

- API: `app/api/admin/orders/[id]/route.ts` (schema requires `expectedStatus`).
- UI: `app/admin/(panel)/orders/order-detail-view.tsx` sends `{ status, expectedStatus: order.status }`.
- Both ship in the same Next.js deployment, so a fresh page load is always consistent. No other client calls this endpoint.

## Risk and handling

- **Stale admin tabs:** a browser tab loaded before the release still runs the old UI, which omits `expectedStatus`; its status change is rejected with `400` ("Geçersiz sipariş durumu") and nothing is written. The fix is a page refresh.
- **Release step:** after deployment, tell active admins to refresh the admin panel before changing order statuses. Do not relax the API to make `expectedStatus` optional: that would reopen the double-cancel / double-transition race the change closed.
- **Rollback:** rolling the application back removes the requirement together with the UI change; no data migration is involved.
- **Verification:** `tests/order-transition.test.ts` and the real-PostgreSQL suite (`pnpm test:postgres`) cover stale, duplicate and concurrent transitions.
