CREATE TABLE "legal_document_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"content_hash" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"published_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_legal_acceptances" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"document_version_id" text NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legal_document_versions" ADD CONSTRAINT "legal_document_versions_document_id_legal_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."legal_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_legal_acceptances" ADD CONSTRAINT "order_legal_acceptances_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_legal_acceptances" ADD CONSTRAINT "order_legal_acceptances_document_version_id_legal_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."legal_document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legal_document_versions_doc_version_uq" ON "legal_document_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_documents_slug_uq" ON "legal_documents" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "order_legal_acceptances_order_version_uq" ON "order_legal_acceptances" USING btree ("order_id","document_version_id");--> statement-breakpoint
CREATE INDEX "order_legal_acceptances_version_idx" ON "order_legal_acceptances" USING btree ("document_version_id");