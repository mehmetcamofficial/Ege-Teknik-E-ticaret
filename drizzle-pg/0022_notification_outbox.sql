-- H5-A: transactional notification outbox (order received / new order alert).
-- ADDITIVE ONLY: one new table, no existing row or column is touched.
-- Rows are written by the checkout transaction (inside a SAVEPOINT, so a missing grant or table can never fail an order)
-- and delivered AFTER commit by an authorized worker; delivery success is never a precondition for an order.
-- Holds no recipient address, subject or body: those are rendered from the order at send time. No secrets.
-- UYGULANMADI: Neon/Preview/Production veritabanına uygulama. Operatör yetkileri: docs/ops/notification-outbox-grants-20261022.sql
CREATE TABLE "notification_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"order_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error_code" text,
	"last_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_outbox_kind_ck" CHECK ("notification_outbox"."kind" IN ('order_customer_received','order_admin_new')),
	CONSTRAINT "notification_outbox_status_ck" CHECK ("notification_outbox"."status" IN ('pending','sending','sent','dead')),
	CONSTRAINT "notification_outbox_attempts_ck" CHECK ("notification_outbox"."attempts" >= 0 AND "notification_outbox"."attempts" <= 20),
	CONSTRAINT "notification_outbox_sent_ck" CHECK (("notification_outbox"."status" = 'sent') = ("notification_outbox"."sent_at" IS NOT NULL)),
	CONSTRAINT "notification_outbox_dedupe_ck" CHECK ("notification_outbox"."dedupe_key" = 'order:' || "notification_outbox"."order_id" || ':' || "notification_outbox"."kind"),
	CONSTRAINT "notification_outbox_error_ck" CHECK ("notification_outbox"."last_error_code" IS NULL OR "notification_outbox"."last_error_code" ~ '^[a-z0-9_]{1,40}$')
);
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_outbox_dedupe_uq" ON "notification_outbox" USING btree ("dedupe_key");
--> statement-breakpoint
CREATE INDEX "notification_outbox_due_idx" ON "notification_outbox" USING btree ("status","next_attempt_at");
--> statement-breakpoint
CREATE INDEX "notification_outbox_order_idx" ON "notification_outbox" USING btree ("order_id");
