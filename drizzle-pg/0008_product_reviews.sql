CREATE TABLE "product_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"rating" smallint NOT NULL,
	"display_name" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"verified_purchase" boolean DEFAULT false NOT NULL,
	"order_item_id" text,
	"content_hash" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"ip_hash" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"moderated_at" timestamp with time zone,
	"moderated_by" text,
	"moderation_note" text,
	CONSTRAINT "product_reviews_rating_ck" CHECK ("product_reviews"."rating" BETWEEN 1 AND 5),
	CONSTRAINT "product_reviews_status_ck" CHECK ("product_reviews"."status" IN ('pending','approved','rejected')),
	CONSTRAINT "product_reviews_display_name_ck" CHECK (char_length("product_reviews"."display_name") BETWEEN 2 AND 40),
	CONSTRAINT "product_reviews_body_ck" CHECK (char_length("product_reviews"."body") BETWEEN 10 AND 2000),
	CONSTRAINT "product_reviews_verified_ck" CHECK ("product_reviews"."verified_purchase" = ("product_reviews"."order_item_id" IS NOT NULL)),
	CONSTRAINT "product_reviews_content_hash_ck" CHECK ("product_reviews"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "product_reviews_idempotency_ck" CHECK (char_length("product_reviews"."idempotency_key") BETWEEN 8 AND 200),
	CONSTRAINT "product_reviews_note_ck" CHECK ("product_reviews"."moderation_note" IS NULL OR char_length("product_reviews"."moderation_note") <= 500),
	CONSTRAINT "product_reviews_moderation_ck" CHECK (("product_reviews"."status" = 'pending' AND "product_reviews"."moderated_at" IS NULL AND "product_reviews"."moderated_by" IS NULL) OR ("product_reviews"."status" <> 'pending' AND "product_reviews"."moderated_at" IS NOT NULL AND "product_reviews"."moderated_by" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_moderated_by_admin_users_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_reviews_idempotency_uq" ON "product_reviews" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "product_reviews_order_item_live_uq" ON "product_reviews" USING btree ("order_item_id") WHERE "product_reviews"."order_item_id" IS NOT NULL AND "product_reviews"."status" IN ('pending','approved');--> statement-breakpoint
CREATE UNIQUE INDEX "product_reviews_content_live_uq" ON "product_reviews" USING btree ("product_id","content_hash") WHERE "product_reviews"."status" IN ('pending','approved');--> statement-breakpoint
CREATE INDEX "product_reviews_public_idx" ON "product_reviews" USING btree ("product_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "product_reviews_moderation_idx" ON "product_reviews" USING btree ("status","created_at");--> statement-breakpoint
CREATE FUNCTION "product_reviews_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'pending' OR NEW."moderated_at" IS NOT NULL OR NEW."moderated_by" IS NOT NULL OR NEW."moderation_note" IS NOT NULL THEN
      RAISE EXCEPTION 'new product reviews must start pending and unmoderated' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."order_item_id" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "order_items" oi JOIN "orders" o ON o."id" = oi."order_id"
      WHERE oi."id" = NEW."order_item_id" AND oi."product_id" = NEW."product_id" AND o."status" IN ('delivered','installation','completed')
    ) THEN
      RAISE EXCEPTION 'a verified review requires an eligible order line for the same product' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."product_id" IS DISTINCT FROM OLD."product_id" OR NEW."rating" IS DISTINCT FROM OLD."rating"
    OR NEW."display_name" IS DISTINCT FROM OLD."display_name" OR NEW."body" IS DISTINCT FROM OLD."body"
    OR NEW."verified_purchase" IS DISTINCT FROM OLD."verified_purchase" OR NEW."order_item_id" IS DISTINCT FROM OLD."order_item_id"
    OR NEW."content_hash" IS DISTINCT FROM OLD."content_hash" OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key" THEN
    RAISE EXCEPTION 'product review content is immutable; only moderation fields may change' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."status" = 'pending' AND OLD."status" <> 'pending' THEN
    RAISE EXCEPTION 'a moderated product review cannot return to pending' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "product_reviews_guard_trg" BEFORE INSERT OR UPDATE ON "product_reviews" FOR EACH ROW EXECUTE FUNCTION "product_reviews_guard"();
