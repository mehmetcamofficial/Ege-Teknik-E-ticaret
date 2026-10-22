-- Ege Teknik QA checkout/legal ACL verifier
-- Read-only. Run ONLY as ege_qa_storefront_login against isolated QA branch
-- br-delicate-frost-awnf26nw (endpoint ep-square-dust-awrzxg05).
-- This is a static ACL / schema gate; does NOT prove HTTP checkout works.
\set ON_ERROR_STOP on
\pset pager off

SELECT current_user AS connected_role, current_database() AS database,
       inet_server_addr() AS server_ip;

WITH checks(name,pass) AS (
 VALUES
 ('qa_storefront_role',current_user='ege_qa_storefront_login'),
 ('products_read',has_table_privilege(current_user,'public.products','SELECT')),
 ('legal_documents_read',has_table_privilege(current_user,'public.legal_documents','SELECT')),
 ('legal_versions_read',has_table_privilege(current_user,'public.legal_document_versions','SELECT')),
 ('orders_insert',has_table_privilege(current_user,'public.orders','INSERT')),
 ('orders_update_denied',NOT has_table_privilege(current_user,'public.orders','UPDATE')),
 ('orders_delete_denied',NOT has_table_privilege(current_user,'public.orders','DELETE')),
 ('products_update_denied',NOT has_table_privilege(current_user,'public.products','UPDATE')),
 ('admins_read_denied',NOT has_table_privilege(current_user,'public.admin_users','SELECT')),
 ('admin_invites_read_denied',NOT has_table_privilege(current_user,'public.admin_invites','SELECT')),
 ('inventory_onhand_update',has_column_privilege(current_user,'public.inventory','on_hand','UPDATE')),
 ('inventory_reorder_update_denied',NOT has_column_privilege(current_user,'public.inventory','reorder_level','UPDATE')),
 ('legal_slug_update_denied',NOT has_column_privilege(current_user,'public.legal_documents','slug','UPDATE')),
 ('legal_createdat_lock_granted',has_column_privilege(current_user,'public.legal_documents','created_at','UPDATE')),
 ('checkout_lock_execute',has_function_privilege(current_user,'public.lock_checkout_products(text[])','EXECUTE')),
 ('evidence_update_denied',NOT has_table_privilege(current_user,'public.order_legal_acceptances','UPDATE')),
 ('evidence_delete_denied',NOT has_table_privilege(current_user,'public.order_legal_acceptances','DELETE')),
 ('legal_immutable_trigger_enabled',EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.legal_documents'::regclass AND tgname='legal_documents_immutable_guard_trg' AND tgenabled='O')),
 ('legal_evidence_trigger_enabled',EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.order_legal_acceptances'::regclass AND tgname='order_legal_evidence_guard_trg' AND tgenabled='O')),
 ('checkout_product_lock_definer',EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.lock_checkout_products(text[])'::regprocedure AND prosecdef)),
 ('legal_evidence_guard_definer',EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.order_legal_evidence_guard()'::regprocedure AND prosecdef))
)
SELECT name,CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result
FROM checks ORDER BY name;

-- Privacy exposure gate (expected to FAIL, requires architecture change).
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       has_table_privilege(current_user,c.oid,'SELECT') AS full_select,
       CASE WHEN NOT c.relrowsecurity AND has_table_privilege(current_user,c.oid,'SELECT')
            THEN 'BLOCKED: PII READ EXPOSURE' ELSE 'REVIEW' END AS privacy_gate
FROM pg_class c
WHERE c.oid IN ('public.orders'::regclass,'public.customers'::regclass,
                'public.addresses'::regclass,'public.order_legal_acceptances'::regclass)
ORDER BY 1;
