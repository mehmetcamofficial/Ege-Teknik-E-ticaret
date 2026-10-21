ALTER TABLE "orders" ADD COLUMN "order_issued_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "legal_evidence_version" smallint;
--> statement-breakpoint
ALTER TABLE "order_legal_acceptances" ADD COLUMN "slug" text;
--> statement-breakpoint
ALTER TABLE "order_legal_acceptances" ADD COLUMN "title" text;
--> statement-breakpoint
ALTER TABLE "order_legal_acceptances" ADD COLUMN "version" integer;
--> statement-breakpoint
ALTER TABLE "order_legal_acceptances" ADD COLUMN "template_content_hash" text;
--> statement-breakpoint
ALTER TABLE "order_legal_acceptances" ADD COLUMN "rendered_body" text;
--> statement-breakpoint
ALTER TABLE "order_legal_acceptances" ADD COLUMN "rendered_sha256" text;
--> statement-breakpoint
ALTER TABLE "order_legal_acceptances" ADD COLUMN "render_context_version" smallint;
--> statement-breakpoint
ALTER TABLE "order_legal_acceptances" ADD COLUMN "acceptance_type" text;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_legal_evidence_cohort_ck" CHECK ((order_issued_at IS NULL AND legal_evidence_version IS NULL) OR (order_issued_at IS NOT NULL AND legal_evidence_version IS NOT NULL AND legal_evidence_version = 1));
--> statement-breakpoint
ALTER TABLE "order_legal_acceptances" ADD CONSTRAINT "order_legal_acceptances_evidence_cohort_ck" CHECK (("slug" IS NULL AND "title" IS NULL AND "version" IS NULL AND "template_content_hash" IS NULL AND "rendered_body" IS NULL AND "rendered_sha256" IS NULL AND "render_context_version" IS NULL AND "acceptance_type" IS NULL) OR ("slug" IS NOT NULL AND "title" IS NOT NULL AND "version" IS NOT NULL AND "template_content_hash" IS NOT NULL AND "rendered_body" IS NOT NULL AND "rendered_sha256" IS NOT NULL AND "render_context_version" IS NOT NULL AND "acceptance_type" IS NOT NULL AND "slug" IN ('distance-sales','pre-information') AND char_length("title") > 0 AND "version" > 0 AND "template_content_hash" ~ '^[0-9a-f]{64}$' AND char_length("rendered_body") > 0 AND "rendered_sha256" ~ '^[0-9a-f]{64}$' AND "render_context_version" = 2 AND "acceptance_type" = 'checkout_required'));
--> statement-breakpoint
ALTER TABLE "order_legal_acceptances" ADD CONSTRAINT "order_legal_acceptances_body_digest_ck" CHECK (rendered_body IS NULL OR rendered_sha256 = encode(sha256(convert_to(rendered_body, 'UTF8')), 'hex'));
--> statement-breakpoint
CREATE UNIQUE INDEX "order_legal_acceptances_order_slug_uq" ON "order_legal_acceptances" ("order_id", "slug") WHERE "slug" IS NOT NULL;
--> statement-breakpoint
-- Serialize version writers with checkout's shared document-row locks; no table lock.
CREATE FUNCTION legal_evidence_source_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM legal_documents WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.document_id ELSE NEW.document_id END FOR UPDATE;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER legal_evidence_source_lock_trg BEFORE INSERT OR UPDATE OR DELETE ON legal_document_versions FOR EACH ROW EXECUTE FUNCTION legal_evidence_source_lock();
--> statement-breakpoint
CREATE FUNCTION order_legal_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_version smallint; source record;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF OLD.slug IS NOT NULL OR (TG_OP = 'UPDATE' AND NEW.slug IS NOT NULL) THEN
      RAISE EXCEPTION 'legal evidence is immutable' USING ERRCODE = '23001';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  SELECT legal_evidence_version INTO parent_version FROM orders WHERE id = NEW.order_id FOR KEY SHARE;
  IF (parent_version IS NULL) <> (NEW.slug IS NULL) THEN
    RAISE EXCEPTION 'order and evidence cohorts differ' USING ERRCODE = '23514';
  END IF;
  IF NEW.slug IS NOT NULL THEN
    SELECT d.slug, v.title, v.version, v.content_hash, v.published_at, v.effective_at INTO source
      FROM legal_document_versions v JOIN legal_documents d ON d.id = v.document_id WHERE v.id = NEW.document_version_id;
    IF NOT FOUND OR ROW(source.slug, source.title, source.version, source.content_hash) IS DISTINCT FROM ROW(NEW.slug, NEW.title, NEW.version, NEW.template_content_hash)
      OR source.published_at IS NULL OR source.effective_at IS NULL OR source.published_at > NEW.accepted_at OR source.effective_at > NEW.accepted_at THEN
      RAISE EXCEPTION 'legal evidence provenance invalid' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER order_legal_evidence_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON order_legal_acceptances FOR EACH ROW EXECUTE FUNCTION order_legal_evidence_guard();
--> statement-breakpoint
CREATE FUNCTION p3_order_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.legal_evidence_version IS NOT NULL OR NEW.legal_evidence_version IS NOT NULL) AND
    ROW(NEW.id, NEW.order_number, NEW.order_issued_at, NEW.legal_evidence_version, NEW.idempotency_key, NEW.request_fingerprint, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.order_number, OLD.order_issued_at, OLD.legal_evidence_version, OLD.idempotency_key, OLD.request_fingerprint, OLD.created_at) THEN
    RAISE EXCEPTION 'P3 order identity is immutable' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER p3_order_identity_guard_trg BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION p3_order_identity_guard();
--> statement-breakpoint
CREATE FUNCTION p3_order_evidence_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id text; parent orders%ROWTYPE; n integer; earliest timestamptz; latest timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'orders' THEN target_id := NEW.id; ELSE target_id := NEW.order_id; END IF;
  SELECT * INTO parent FROM orders WHERE id = target_id;
  IF NOT FOUND OR parent.legal_evidence_version IS NULL THEN RETURN NULL; END IF;
  SELECT count(*), min(accepted_at), max(accepted_at) INTO n, earliest, latest FROM order_legal_acceptances WHERE order_id = target_id;
  IF n <> 2 OR earliest IS DISTINCT FROM latest OR earliest IS DISTINCT FROM parent.created_at OR parent.order_issued_at > earliest
    OR (SELECT count(DISTINCT slug) FROM order_legal_acceptances WHERE order_id = target_id AND slug IN ('distance-sales','pre-information') AND render_context_version = 2) <> 2 THEN
    RAISE EXCEPTION 'P3 order requires exactly two complete legal evidence records' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER p3_order_evidence_complete_trg AFTER INSERT OR UPDATE ON orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION p3_order_evidence_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER p3_acceptance_evidence_complete_trg AFTER INSERT OR UPDATE ON order_legal_acceptances DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION p3_order_evidence_complete();
--> statement-breakpoint
-- Row guards do not handle TRUNCATE. Fail closed independently of runtime grants.
CREATE FUNCTION p3_legal_evidence_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'legal evidence cannot be truncated' USING ERRCODE = '23001';
END $$;
--> statement-breakpoint
CREATE TRIGGER p3_legal_evidence_no_truncate_trg BEFORE TRUNCATE ON order_legal_acceptances FOR EACH STATEMENT EXECUTE FUNCTION p3_legal_evidence_no_truncate();
