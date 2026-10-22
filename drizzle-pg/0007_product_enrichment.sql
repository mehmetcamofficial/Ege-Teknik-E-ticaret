ALTER TABLE "products" ADD COLUMN "short_description" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "gallery" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "specifications" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "documents" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "manufacturer_warranty" jsonb;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "source_url" text;