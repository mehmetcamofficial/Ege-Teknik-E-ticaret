-- EFT-04B: ADDITIVE, REVIEW-ONLY bank metadata and transfer reconciliation.
-- No full IBAN, bank credentials, actual statements or customer secrets.
-- No payment writes, users/grants updates or status changes to existing orders.
CREATE TABLE "merchant_bank_accounts" (
  "id" text PRIMARY KEY,
  "bank_code" text NOT NULL,
  "account_label" text NOT NULL,
  "iban_last4" text NOT NULL,
  "currency" text NOT NULL DEFAULT 'TRY',
  "status" text NOT NULL DEFAULT 'draft',
  "verified_by" text,
  "verified_at" timestamptz,
  "approved_by" text,
  "approved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "eft_accounts_iban_last4_ck" CHECK ("iban_last4" ~ '^[0-9]{4}$'),
  CONSTRAINT "eft_accounts_currency_ck" CHECK ("currency" = 'TRY'),
  CONSTRAINT "eft_accounts_status_ck" CHECK ("status" IN ('draft','verified','disabled')),
  CONSTRAINT "eft_accounts_approval_ck" CHECK ("status" <> 'verified' OR ("verified_by" IS NOT NULL AND "verified_at" IS NOT NULL AND "approved_by" IS NOT NULL AND "approved_at" IS NOT NULL AND "verified_by" <> "approved_by"))
);
--> statement-breakpoint
CREATE TABLE "bank_movements" (
  "id" text PRIMARY KEY,
  "bank_account_id" text NOT NULL REFERENCES "merchant_bank_accounts"("id"),
  "bank_transaction_id" text NOT NULL,
  "amount_tl" integer NOT NULL,
  "direction" text NOT NULL,
  "memo" text NOT NULL DEFAULT '',
  "occurred_at" timestamptz NOT NULL,
  "status" text NOT NULL DEFAULT 'unmatched',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "eft_movements_amount_ck" CHECK ("amount_tl" > 0),
  CONSTRAINT "eft_movements_direction_ck" CHECK ("direction" IN ('credit','debit')),
  CONSTRAINT "eft_movements_status_ck" CHECK ("status" IN ('unmatched','under_review','reviewed')),
  CONSTRAINT "eft_movements_reference_ck" CHECK (length(btrim("bank_transaction_id")) BETWEEN 4 AND 100),
  CONSTRAINT "eft_movements_account_tx_uq" UNIQUE ("bank_account_id","bank_transaction_id")
);
--> statement-breakpoint
CREATE INDEX "eft_movements_status_occurred_idx" ON "bank_movements" ("status","occurred_at");
--> statement-breakpoint
CREATE TABLE "eft_reconciliation_reviews" (
  "id" text PRIMARY KEY,
  "movement_id" text NOT NULL REFERENCES "bank_movements"("id"),
  "order_id" text REFERENCES "orders"("id"),
  "status" text NOT NULL DEFAULT 'pending',
  "decision_reason" text NOT NULL DEFAULT '',
  "reviewed_by" text,
  "reviewed_at" timestamptz,
  "approved_by" text,
  "approved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "eft_reviews_movement_uq" UNIQUE ("movement_id"),
  CONSTRAINT "eft_reviews_status_ck" CHECK ("status" IN ('pending','approved','rejected')),
  CONSTRAINT "eft_reviews_approval_ck" CHECK ("status" <> 'approved' OR ("order_id" IS NOT NULL AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL AND "approved_by" IS NOT NULL AND "approved_at" IS NOT NULL AND "reviewed_by" <> "approved_by")),
  CONSTRAINT "eft_reviews_rejection_ck" CHECK ("status" <> 'rejected' OR length(btrim("decision_reason")) >= 3)
);
--> statement-breakpoint
CREATE INDEX "eft_reviews_status_created_idx" ON "eft_reconciliation_reviews" ("status","created_at");
