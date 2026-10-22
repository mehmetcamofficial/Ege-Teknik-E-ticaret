-- Checkout needs a row lock on product prices/status without granting UPDATE on products
-- to the storefront role. Keep the lock in the order transaction.
-- The migration owner executes the lock. The function returns no product data.
CREATE FUNCTION public.lock_checkout_products(p_product_ids text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $lock$
DECLARE
  unique_count integer;
  locked_count integer;
BEGIN
  IF p_product_ids IS NULL OR cardinality(p_product_ids) < 1 OR cardinality(p_product_ids) > 25
     OR array_position(p_product_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid checkout product set' USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT item.id) INTO unique_count
  FROM unnest(p_product_ids) AS item(id);
  IF unique_count <> cardinality(p_product_ids) THEN
    RAISE EXCEPTION 'duplicate checkout product' USING ERRCODE = '22023';
  END IF;

  -- Sorted shared row locks serialize with admin product UPDATE/DELETE while
  -- allowing concurrent checkout readers. Caller keeps locks until COMMIT/ROLLBACK.
  PERFORM p.id FROM public.products AS p
    WHERE p.id = ANY(p_product_ids)
    ORDER BY p.id
    FOR SHARE;
  GET DIAGNOSTICS locked_count = ROW_COUNT;
  IF locked_count <> cardinality(p_product_ids) THEN
    RAISE EXCEPTION 'checkout product unavailable' USING ERRCODE = '23514';
  END IF;
END
$lock$;
--> statement-breakpoint
-- PostgreSQL functions are executable by PUBLIC by default. Fail closed:
-- grant EXECUTE only to a verified non-superuser runtime role during rollout.
REVOKE ALL ON FUNCTION public.lock_checkout_products(text[]) FROM PUBLIC;
