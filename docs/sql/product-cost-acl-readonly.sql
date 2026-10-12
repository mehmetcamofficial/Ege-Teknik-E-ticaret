-- Ege Teknik: READ-ONLY product-cost database ACL verification.
-- Run on a disposable child branch once separate roles and table exist.
-- Never assume these role names match deployed PostgreSQL roles.
-- No DDL, no GRANT, no ALTER ROLE and no credential retrieval.
SELECT current_database() AS db, current_user AS inspector,
  to_regclass('public.product_cost_profiles') AS cost_table;
SELECT rolname, rolcanlogin, rolbypassrls, rolsuper
FROM pg_roles
WHERE rolname IN ('storefront_runtime', 'admin_runtime')
ORDER BY rolname;
-- Only run the next query AFTER the roles and table actually exist:
-- SELECT
--   has_table_privilege('storefront_runtime','public.product_cost_profiles','SELECT') AS storefront_select,
--   has_table_privilege('storefront_runtime','public.product_cost_profiles','INSERT') AS storefront_insert,
--   has_table_privilege('storefront_runtime','public.product_cost_profiles','UPDATE') AS storefront_update,
--   has_table_privilege('storefront_runtime','public.product_cost_profiles','DELETE') AS storefront_delete,
--   has_table_privilege('admin_runtime','public.product_cost_profiles','SELECT') AS admin_select,
--   has_table_privilege('admin_runtime','public.product_cost_profiles','INSERT') AS admin_insert,
--   has_table_privilege('admin_runtime','public.product_cost_profiles','UPDATE') AS admin_update;
-- PASS: all storefront privileges = false, all required admin privileges = true.
-- Also inspect memberships, PUBLIC grants, function EXECUTE grants, schema USAGE,
-- view owner security behavior, and any SECURITY DEFINER paths before passing.
