# EFT-04B — Bank transfer reconciliation (design gate)

Status: DESIGN ONLY — no migration applied, no payment enabled, no production/preview change.

## Existing baseline
- Drizzle schema: `db/schema.ts`; journal: `drizzle-pg/meta/_journal.json` (latest 0025).
- `payments` is the provider-neutral ledger; `method='bank_transfer'` is supported.
- Do not equate an imported bank movement, user-submitted receipt, or an order reference with verified payment.

## Proposed additive schema (requires migration review)
1. `merchant_bank_accounts`: id, bank label, account holder, masked IBAN/display alias, encrypted/tokenized IBAN reference (never plaintext in audit), currency, active, timestamps. Account credentials must not be stored.
2. `bank_movements`: id, bank_account_id FK, source, external_transaction_id, amount_minor (signed bigint), currency, booked_at, normalized_reference, payload_digest, import_batch_id, imported_at; unique(account, source, external_transaction_id) where ID exists; separate replay-resistant digest key where ID absent.
3. `eft_reconciliation_reviews`: id, movement_id FK, order_id FK nullable, status (unmatched/proposed/needs_review/approved/rejected), proposed_amount_minor, created_by, reviewed_by, approved_by, timestamps, reason code, revision. Restrict movement allocation to prevent double-spend.

## Security invariants
- Import is staging-only: no imported movement can automatically mark an order paid.
- Bank confirmation requires a verified bank statement/source and explicit human approval.
- Enforce amount/currency/order identity; mismatches or partial/overpayment go to review.
- Two distinct authorized actors for sensitive approval; enforce server-side and transactionally.
- Idempotency and locking must cover movement, reconciliation, and final payment ledger write in one database transaction.
- Approval creates at most one `payments` ledger entry; use a deterministic unique provider transaction key and a reconciliation FK/unique constraint.
- All changes append audit records without account numbers, full bank payloads, or secrets.
- RBAC must deny storefront/checkout and unprivileged admin roles; test grants with real PostgreSQL.
- Do not use real bank credentials or live bank API. No production or preview writes.

## Implementation order
1. Inspect existing finance APIs, permission matrix, migrations and tests.
2. Write additive migration + Drizzle schema in a follow-up commit after compatibility review.
3. Implement staging, review and approval with transactional locking and fail-closed checks.
4. Unit + isolated disposable PostgreSQL tests: duplicate import, replay, currency mismatch, partial/overpayment, conflicting approval, actor separation, privilege denial, rollback.
5. CI checks and draft PR. Production release remains NO-GO until explicit approval.
