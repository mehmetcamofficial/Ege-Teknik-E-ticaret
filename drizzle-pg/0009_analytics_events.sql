CREATE TABLE "analytics_events" (
	"id" text PRIMARY KEY NOT NULL,
	"visitor_id" text NOT NULL,
	"path" text NOT NULL,
	"product_id" text,
	"referrer_host" text,
	"device" text NOT NULL,
	"is_bot" boolean DEFAULT false NOT NULL,
	"is_new_visitor" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_events_path_ck" CHECK (char_length("analytics_events"."path") BETWEEN 1 AND 200 AND "analytics_events"."path" LIKE '/%'),
	CONSTRAINT "analytics_events_device_ck" CHECK ("analytics_events"."device" IN ('mobile','tablet','desktop')),
	CONSTRAINT "analytics_events_visitor_ck" CHECK ("analytics_events"."visitor_id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);
--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_events_created_idx" ON "analytics_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "analytics_events_visitor_created_idx" ON "analytics_events" USING btree ("visitor_id","created_at");--> statement-breakpoint
CREATE INDEX "analytics_events_path_created_idx" ON "analytics_events" USING btree ("path","created_at");--> statement-breakpoint
CREATE INDEX "analytics_events_product_created_idx" ON "analytics_events" USING btree ("product_id","created_at");