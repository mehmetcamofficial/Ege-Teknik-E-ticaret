ALTER TABLE "legal_document_versions" ALTER COLUMN "effective_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "legal_document_versions" ALTER COLUMN "published_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "legal_document_versions" ALTER COLUMN "published_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "legal_document_versions" ADD CONSTRAINT "legal_document_versions_publication_ck" CHECK (("legal_document_versions"."published_at" IS NULL AND "legal_document_versions"."published_by" IS NULL) OR ("legal_document_versions"."published_at" IS NOT NULL AND "legal_document_versions"."published_by" IS NOT NULL AND "legal_document_versions"."effective_at" IS NOT NULL));--> statement-breakpoint
CREATE FUNCTION "legal_document_versions_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."published_at" IS NOT NULL THEN
    RAISE EXCEPTION 'published legal document versions are immutable (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."id" IS DISTINCT FROM OLD."id" OR NEW."document_id" IS DISTINCT FROM OLD."document_id" OR NEW."version" IS DISTINCT FROM OLD."version") THEN
    RAISE EXCEPTION 'legal document version identity is immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "legal_document_versions_guard_trg" BEFORE UPDATE OR DELETE ON "legal_document_versions" FOR EACH ROW EXECUTE FUNCTION "legal_document_versions_guard"();
