-- Follow-up to 0015: legal document identity and creation timestamp are immutable.
-- The runtime role may need UPDATE(created_at) to acquire FOR UPDATE row locks,
-- but it must not be able to change that value.
-- This trigger does not replace least-privilege column ACLs.
CREATE FUNCTION public.legal_documents_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $guard$
BEGIN
  IF ROW(NEW.id, NEW.slug, NEW.created_at) IS DISTINCT FROM
     ROW(OLD.id, OLD.slug, OLD.created_at) THEN
    RAISE EXCEPTION 'legal document identity and created_at are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$guard$;
--> statement-breakpoint
CREATE TRIGGER legal_documents_immutable_guard_trg
  BEFORE UPDATE ON public.legal_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.legal_documents_immutable_guard();
