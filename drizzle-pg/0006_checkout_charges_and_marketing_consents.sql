CREATE TABLE "marketing_consents" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"channel" text NOT NULL,
	"granted" boolean NOT NULL,
	"order_id" text,
	"source" text DEFAULT 'checkout' NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_consents_channel_ck" CHECK ("marketing_consents"."channel" IN ('sms','email','whatsapp'))
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "installation_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_consents" ADD CONSTRAINT "marketing_consents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_consents" ADD CONSTRAINT "marketing_consents_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "marketing_consents_customer_channel_idx" ON "marketing_consents" USING btree ("customer_id","channel","recorded_at");