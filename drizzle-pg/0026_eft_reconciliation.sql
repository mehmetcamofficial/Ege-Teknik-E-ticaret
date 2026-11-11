-- EFT-04B: additive staging schema. NOT APPLIED to Preview/Production.
-- Amount unit: integer TRY, matching orders.total/payments.amount. No automatic settlement.
CREATE TABLE "merchant_bank_accounts" (
 "id" text PRIMARY KEY NOT NULL,
 "bank_label" text NOT NULL,
 "account_alias" text NOT NULL,
 "iban_last4" text NOT NULL,
 "currency" text NOT NULL DEFAULT 'TRY',
 "active" boolean NOT NULL DEFAULT false,
 "created_at" timestamptz NOT NULL DEFAULT now(),
 "updated_at" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "merchant_bank_accounts_iban_last4_ck" CHECK (iban_last4 ~ '^[0-9]{4}$'),
 CONSTRAINT "merchant_bank_accounts_currency_ck" CHECK (currency = 'TRY')
);
--> statement-breakpoint
CREATE TABLE "bank_movements" (
 "id" text PRIMARY KEY NOT NULL,
 "bank_account_id" text NOT NULL REFERENCES "merchant_bank_accounts"("id"),
 "source" text NOT NULL,
 "external_transaction_id" text,
 "import_fingerprint" text NOT NULL,
 "amount" integer NOT NULL,
 "currency" text NOT NULL DEFAULT 'TRY',
 "booked_at" timestamptz NOT NULL,
 "reference" text NOT NULL DEFAULT '',
 "imported_at" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "bank_movements_amount_ck" CHECK (amount <> 0),
 CONSTRAINT "bank_movements_currency_ck" CHECK (currency = 'TRY'),
 CONSTRAINT "bank_movements_fingerprint_ck" CHECK (import_fingerprint ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_movements_external_uq" ON "bank_movements" ("bank_account_id","source","external_transaction_id") WHERE "external_transaction_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_movements_fingerprint_uq" ON "bank_movements" ("bank_account_id","source","import_fingerprint");
--> statement-breakpoint
CREATE TABLE "eft_reconciliation_reviews" (
 "id" text PRIMARY KEY NOT NULL,
 "movement_id" text NOT NULL REFERENCES "bank_movements"("id"),
 "order_id" text REFERENCES "orders"("id"),
 "status" text NOT NULL DEFAULT 'unmatched',
 "proposed_amount" integer,
 "created_by" text NOT NULL REFERENCES "admin_users"("id"),
 "reviewed_by" text REFERENCES "admin_users"("id"),
 "approved_by" text REFERENCES "admin_users"("id"),
 "payment_id" text UNIQUE REFERENCES "payments"("id"),
 "reason_code" text NOT NULL DEFAULT '',
 "revision" integer NOT NULL DEFAULT 1,
 "created_at" timestamptz NOT NULL DEFAULT now(),
 "updated_at" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "eft_reviews_status_ck" CHECK (status IN ('unmatched','proposed','needs_review','approved','rejected')),
 CONSTRAINT "eft_reviews_amount_ck" CHECK (proposed_amount IS NULL OR proposed_amount > 0),
 CONSTRAINT "eft_reviews_revision_ck" CHECK (revision > 0),
 CONSTRAINT "eft_reviews_distinct_actors_ck" CHECK (approved_by IS NULL OR (approved_by <> created_by AND (reviewed_by IS NULL OR approved_by <> reviewed_by))),
 CONSTRAINT "eft_reviews_approved_ck" CHECK (status <> 'approved' OR (order_id IS NOT NULL AND payment_id IS NOT NULL AND reviewed_by IS NOT NULL AND approved_by IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "eft_reviews_movement_approved_uq" ON "eft_reconciliation_reviews" ("movement_id") WHERE "status" = 'approved';
--> statement-breakpoint
CREATE INDEX "eft_reviews_status_created_idx" ON "eft_reconciliation_reviews" ("status","created_at");
--> statement-breakpoint
REVOKE ALL ON "merchant_bank_accounts","bank_movements","eft_reconciliation_reviews" FROM PUBLIC;
