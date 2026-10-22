ALTER TABLE "products" ADD COLUMN "delivery_class" text DEFAULT 'installed_delivery' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_delivery_class_ck" CHECK ("products"."delivery_class" IN ('installed_delivery','shippable','local_delivery'));--> statement-breakpoint
-- Deterministic backfill: spare parts are identified by their stable category id (never by a display label).
-- Idempotent; touches only rows in that category. Every other product keeps the safe default (installed_delivery).
UPDATE "products" SET "delivery_class" = 'shippable' WHERE "category_id" = 'category-yedek-parca';
