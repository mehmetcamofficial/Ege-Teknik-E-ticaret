-- Phase 3.3A finance ledger. Additive only. CHECKs are NOT VALID: enforced for every new/updated row, no rescan of history.
ALTER TABLE "payments" ADD COLUMN "method" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "reference" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "recorded_by" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_admin_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_uq" ON "payments" USING btree ("idempotency_key") WHERE "payments"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_idempotency_uq" ON "refunds" USING btree ("idempotency_key") WHERE "refunds"."idempotency_key" is not null;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_ck" CHECK ("payments"."amount" > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_status_ck" CHECK ("payments"."status" IN ('pending','paid','failed','cancelled')) NOT VALID;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_ck" CHECK ("payments"."method" IS NULL OR "payments"."method" IN ('cash','bank_transfer','pos','online')) NOT VALID;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_paid_at_ck" CHECK ("payments"."status" <> 'paid' OR "payments"."paid_at" IS NOT NULL) NOT VALID;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_ck" CHECK ("refunds"."amount" > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_status_ck" CHECK ("refunds"."status" IN ('pending','completed','failed')) NOT VALID;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_completed_at_ck" CHECK ("refunds"."status" <> 'completed' OR "refunds"."refunded_at" IS NOT NULL) NOT VALID;