-- Narrow the legacy 0015 evidence guard's parent-order row lock to its definer.
-- Storefront needs INSERT into order_legal_acceptances but must not need
-- UPDATE on orders just to satisfy the trigger's SELECT ... FOR KEY SHARE.
-- No data rewrite and no direct runtime privilege grants.
ALTER FUNCTION public.order_legal_evidence_guard() SECURITY DEFINER;
--> statement-breakpoint
-- pg_temp must be explicitly last: otherwise attacker-created temp relations
-- can shadow the unqualified tables in the existing 0015 trigger body.
ALTER FUNCTION public.order_legal_evidence_guard()
  SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
-- Prevent untrusted roles from creating their own triggers that invoke the
-- privileged function; the existing owner-created trigger continues to work.
REVOKE ALL ON FUNCTION public.order_legal_evidence_guard() FROM PUBLIC;
