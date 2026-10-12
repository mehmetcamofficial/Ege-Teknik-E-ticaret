-- P0 privacy: checkout replay can read ONLY an idempotency-key + fingerprint match.
-- The function deliberately returns no row on an unknown key. For a reused key
-- with mismatched fingerprint, return a conflict marker with NO order data.
-- Migrated under schema owner; revoke PUBLIC execute before runtime grants.
CREATE FUNCTION public.checkout_replay_by_key(p_key text, p_fingerprint text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $replay$
DECLARE
  found_order public.orders%ROWTYPE;
BEGIN
  IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9._:-]{8,200}$'
     OR p_fingerprint IS NULL OR p_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid checkout replay request' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO found_order FROM public.orders
  WHERE idempotency_key = p_key LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF found_order.request_fingerprint IS DISTINCT FROM p_fingerprint THEN
    RETURN jsonb_build_object('conflict', true);
  END IF;

  RETURN jsonb_build_object(
    'order', jsonb_build_object(
      'legalEvidenceVersion', found_order.legal_evidence_version,
      'orderIssuedAt', found_order.order_issued_at,
      'orderNumber', found_order.order_number,
      'status', found_order.status,
      'createdAt', found_order.created_at,
      'subtotal', found_order.subtotal,
      'vatTotal', found_order.vat_total,
      'shippingTotal', found_order.shipping_total,
      'installationTotal', found_order.installation_total,
      'total', found_order.total,
      'customerName', found_order.customer_name,
      'phone', found_order.phone,
      'email', found_order.email,
      'city', found_order.city,
      'address', found_order.address,
      'installationPreference', found_order.installation_preference,
      'shippingAddressSnapshot', found_order.shipping_address_snapshot
    ),
    'items', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'productName', i.product_name, 'quantity', i.quantity,
        'unitPrice', i.unit_price, 'lineTotal', i.line_total
      ) ORDER BY i.created_at, i.id), '[]'::jsonb)
      FROM public.order_items i WHERE i.order_id = found_order.id
    ),
    'evidence', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'slug', a.slug, 'documentVersionId', a.document_version_id,
        'title', a.title, 'version', a.version,
        'templateContentHash', a.template_content_hash,
        'renderedBody', a.rendered_body,
        'renderedSha256', a.rendered_sha256,
        'renderContextVersion', a.render_context_version,
        'acceptanceType', a.acceptance_type,
        'acceptedAt', a.accepted_at
      ) ORDER BY a.created_at, a.id), '[]'::jsonb)
      FROM public.order_legal_acceptances a
      WHERE a.order_id = found_order.id
    )
  );
END
$replay$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.checkout_replay_by_key(text,text) FROM PUBLIC;

--> statement-breakpoint
-- The existing 0015 deferred evidence completeness trigger SELECTs orders and
-- order_legal_acceptances. Once runtime direct SELECT is removed, the trigger
-- must perform those reads under its reviewed migration owner. Existing triggers
-- remain attached and enforce the exact same immutable-evidence rules.
ALTER FUNCTION public.p3_order_evidence_complete() SECURITY DEFINER;
--> statement-breakpoint
ALTER FUNCTION public.p3_order_evidence_complete()
  SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.p3_order_evidence_complete() FROM PUBLIC;
