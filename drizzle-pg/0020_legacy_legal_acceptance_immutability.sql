-- Preserve every committed acceptance, including pre-P3 rows whose slug is NULL.
-- Keep 0015/0018 INSERT provenance and 0019 completeness guards unchanged.
-- No backfill, row rewrite or runtime privilege expansion.
CREATE FUNCTION public.legal_acceptance_no_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'legal evidence is immutable' USING ERRCODE = '23001';
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.legal_acceptance_no_mutation() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER legal_acceptance_no_mutation_trg
  BEFORE UPDATE OR DELETE ON public.order_legal_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.legal_acceptance_no_mutation();
