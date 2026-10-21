-- Content registry (P0-B / P1 foundation). ADDITIVE ONLY: creates new tables, touches nothing that exists.
--
-- Canonical editing model (Option C): the DATABASE is canonical for editing; a committed, deterministic
-- content snapshot is canonical for the build. The build never reads this database (non-negotiable #1),
-- so every table here is written by offline importer/export tooling only.
--
-- Today the 16 /rehber/<slug>.html guides are frozen sources in scripts/klima-rehberi/guides-*.mjs.
-- This migration creates the registry that will hold them; it does NOT switch any generator and does
-- NOT change a single public URL, slug or rendered byte (P1 has no public-surface scope).
--
-- NOTE on relations: the guides' `products[]` are CATEGORY/FILTER/CONTACT urls (catalog.html?category=...,
-- catalog.html?btu=..., contact.html?subject=...), NOT product ids. They are therefore preserved verbatim in
-- `content_links`, which stores the literal label+href. `content_related_products` /
-- `content_related_services` exist for genuine entity relations only and are intentionally left empty by
-- the importer rather than filled with invented identifiers.
CREATE TABLE "content_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"entry_type" text DEFAULT 'guide' NOT NULL,
	"slug" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"seo_title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"lead" text DEFAULT '' NOT NULL,
	"answer" text DEFAULT '' NOT NULL,
	"image_key" text DEFAULT '' NOT NULL,
	"image_alt" text DEFAULT '' NOT NULL,
	"image_caption" text DEFAULT '' NOT NULL,
	"image_portrait" boolean,
	"status" text DEFAULT 'published' NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"content_hash" text NOT NULL,
	"source_ref" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_entries_slug_uq" UNIQUE ("slug"),
	CONSTRAINT "content_entries_type_ck" CHECK ("content_entries"."entry_type" IN ('guide')),
	CONSTRAINT "content_entries_status_ck" CHECK ("content_entries"."status" IN ('draft','published','archived')),
	CONSTRAINT "content_entries_slug_ck" CHECK ("content_entries"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "content_entries_content_hash_ck" CHECK ("content_entries"."content_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "content_sections" (
	"entry_id" text NOT NULL,
	"section_key" text NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"html" text NOT NULL,
	CONSTRAINT "content_sections_pkey" PRIMARY KEY ("entry_id","section_key"),
	CONSTRAINT "content_sections_position_uq" UNIQUE ("entry_id","position"),
	CONSTRAINT "content_sections_position_ck" CHECK ("content_sections"."position" >= 0),
	CONSTRAINT "content_sections_key_ck" CHECK ("content_sections"."section_key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "content_faq" (
	"entry_id" text NOT NULL,
	"position" integer NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	CONSTRAINT "content_faq_pkey" PRIMARY KEY ("entry_id","position"),
	CONSTRAINT "content_faq_position_ck" CHECK ("content_faq"."position" >= 0)
);
--> statement-breakpoint
-- Guide -> guide relations. Today's `related[]` in guides-*.mjs is a list of slugs, so it lands here
-- (NOT in content_related_services, which is for service entities).
CREATE TABLE "content_related_entries" (
	"entry_id" text NOT NULL,
	"related_entry_id" text NOT NULL,
	"position" integer NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	CONSTRAINT "content_related_entries_pkey" PRIMARY KEY ("entry_id","related_entry_id"),
	CONSTRAINT "content_related_entries_position_uq" UNIQUE ("entry_id","position"),
	CONSTRAINT "content_related_entries_position_ck" CHECK ("content_related_entries"."position" >= 0),
	CONSTRAINT "content_related_entries_no_self_ck" CHECK ("content_related_entries"."entry_id" <> "content_related_entries"."related_entry_id")
);
--> statement-breakpoint
-- Genuine product relations only (real products.id). Empty until real product ids are curated; the
-- importer must never invent one.
CREATE TABLE "content_related_products" (
	"entry_id" text NOT NULL,
	"product_id" text NOT NULL,
	"position" integer NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	CONSTRAINT "content_related_products_pkey" PRIMARY KEY ("entry_id","product_id"),
	CONSTRAINT "content_related_products_position_uq" UNIQUE ("entry_id","position"),
	CONSTRAINT "content_related_products_position_ck" CHECK ("content_related_products"."position" >= 0)
);
--> statement-breakpoint
-- Service relations, keyed by the public service slug used by /services.html. Not used by the guides today.
CREATE TABLE "content_related_services" (
	"entry_id" text NOT NULL,
	"service_slug" text NOT NULL,
	"position" integer NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	CONSTRAINT "content_related_services_pkey" PRIMARY KEY ("entry_id","service_slug"),
	CONSTRAINT "content_related_services_position_uq" UNIQUE ("entry_id","position"),
	CONSTRAINT "content_related_services_position_ck" CHECK ("content_related_services"."position" >= 0)
);
--> statement-breakpoint
-- Lossless literal links. This is where today's `products[]` go: the exact {label, href} pair is kept
-- verbatim (including query strings and percent-encoding) so nothing is lost and no product id is faked.
-- link_kind is descriptive metadata only; href is the canonical value.
CREATE TABLE "content_links" (
	"entry_id" text NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"href" text NOT NULL,
	"link_kind" text DEFAULT 'link' NOT NULL,
	CONSTRAINT "content_links_pkey" PRIMARY KEY ("entry_id","position"),
	CONSTRAINT "content_links_position_uq" UNIQUE ("entry_id","position"),
	CONSTRAINT "content_links_position_ck" CHECK ("content_links"."position" >= 0),
	CONSTRAINT "content_links_kind_ck" CHECK ("content_links"."link_kind" IN ('link','catalog_filter','category','service','contact','selector','second_hand'))
);
--> statement-breakpoint
-- Append-only edit history. The build never reads this table; it exists for audit and rollback.
CREATE TABLE "content_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"entry_id" text NOT NULL,
	"version" integer NOT NULL,
	"content_hash" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"changed_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_versions_version_uq" UNIQUE ("entry_id","version"),
	CONSTRAINT "content_versions_version_ck" CHECK ("content_versions"."version" >= 1),
	CONSTRAINT "content_versions_content_hash_ck" CHECK ("content_versions"."content_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
-- Ledger of exported snapshots. The committed file is data/content/registry-snapshot.json; this table
-- records which hash was exported, so a build can be tied back to the content it came from.
CREATE TABLE "content_exports" (
	"id" text PRIMARY KEY NOT NULL,
	"target_path" text NOT NULL,
	"content_hash" text NOT NULL,
	"entry_count" integer NOT NULL,
	"generated_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_exports_content_hash_ck" CHECK ("content_exports"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "content_exports_entry_count_ck" CHECK ("content_exports"."entry_count" >= 0)
);
--> statement-breakpoint
-- Redirect registry. Seeded in P1 only where it can be derived losslessly from the already-shipped
-- lib/guide-redirects.ts map; no public routing behaviour changes in P1.
CREATE TABLE "content_redirects" (
	"id" text PRIMARY KEY NOT NULL,
	"from_path" text NOT NULL,
	"to_path" text NOT NULL,
	"status_code" integer DEFAULT 308 NOT NULL,
	"entry_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_redirects_from_path_uq" UNIQUE ("from_path"),
	CONSTRAINT "content_redirects_status_ck" CHECK ("content_redirects"."status_code" IN (301,308))
);
--> statement-breakpoint
ALTER TABLE "content_sections" ADD CONSTRAINT "content_sections_entry_id_content_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."content_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_faq" ADD CONSTRAINT "content_faq_entry_id_content_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."content_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_related_entries" ADD CONSTRAINT "content_related_entries_entry_id_content_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."content_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_related_entries" ADD CONSTRAINT "content_related_entries_related_entry_id_content_entries_id_fk" FOREIGN KEY ("related_entry_id") REFERENCES "public"."content_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_related_products" ADD CONSTRAINT "content_related_products_entry_id_content_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."content_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_related_products" ADD CONSTRAINT "content_related_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_related_services" ADD CONSTRAINT "content_related_services_entry_id_content_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."content_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_links" ADD CONSTRAINT "content_links_entry_id_content_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."content_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_entry_id_content_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."content_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_redirects" ADD CONSTRAINT "content_redirects_entry_id_content_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."content_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_entries_type_status_idx" ON "content_entries" USING btree ("entry_type","status");--> statement-breakpoint
CREATE INDEX "content_entries_published_at_idx" ON "content_entries" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "content_related_entries_related_idx" ON "content_related_entries" USING btree ("related_entry_id");--> statement-breakpoint
CREATE INDEX "content_links_href_idx" ON "content_links" USING btree ("href");--> statement-breakpoint
CREATE INDEX "content_versions_entry_idx" ON "content_versions" USING btree ("entry_id","version");--> statement-breakpoint
CREATE INDEX "content_exports_created_at_idx" ON "content_exports" USING btree ("created_at");

