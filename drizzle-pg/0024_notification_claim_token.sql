-- R-03: per-claim fencing token for the notification outbox.
-- ADDITIVE ONLY: one nullable column and one CHECK on notification_outbox; no existing row, column, index or grant is changed.
-- Every claim of a row writes a fresh random token and every result (sent / retry / dead) is applied only WHERE the row still carries that
-- exact token, so a worker whose lease expired and whose row was re-claimed (or requeued) can no longer change the row or write an audit line.
-- The CHECK keeps the token tied to status 'sending': a row that leaves 'sending' must drop its token in the same UPDATE.
-- UYGULANMADI: Neon/Preview/Production veritabanına uygulama. The worker needs SELECT and UPDATE on this one column:
-- docs/ops/notification-worker-grants-20261024.sql.
-- ROLLOUT ORDER (verified on a disposable cluster): 1) this migration, 2) the operator SQL, 3) the worker code. The operator SQL before this migration fails
-- atomically (42703) and creates nothing; a worker role created by an older operator SQL fails closed at the claim (42501) and sends nothing. Do not run
-- an older worker build once this is applied: its result UPDATE is refused by the CHECK (23514, the row stays 'sending'), so it can never finish a row.
-- ROLLBACK (a person, on purpose; stop the worker first): BEGIN; ALTER TABLE "notification_outbox" DROP CONSTRAINT "notification_outbox_claim_token_ck";
--   ALTER TABLE "notification_outbox" DROP COLUMN "claim_token"; COMMIT;  -- drops the worker's grants on the column with it; no row is changed.
-- After a rollback the older worker build runs again WITHOUT fencing:
-- a stale result can overwrite a newer claim and write a stale audit row
-- (R-03 returns).
-- Mixed old/new workers are unsupported:
-- while an older build holds a claim, a stale new-code result can still apply.
ALTER TABLE "notification_outbox" ADD COLUMN "claim_token" text;
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_claim_token_ck" CHECK ("notification_outbox"."claim_token" IS NULL OR ("notification_outbox"."status" = 'sending' AND "notification_outbox"."claim_token" ~ '^[0-9a-f]{32}$'));
