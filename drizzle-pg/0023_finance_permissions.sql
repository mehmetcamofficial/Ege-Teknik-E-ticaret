-- H5-B: finance permissions and the finance_manager role.
-- ADDITIVE / WIDENING ONLY: three CHECK constraints are replaced by supersets of their old value lists, so every existing row
-- still validates. NO user, role assignment, grant or invitation row is read, inserted, updated or deleted: nobody is promoted
-- by this migration. The new role/permissions are used only after an owner invites a finance_manager or issues a time-boxed grant
-- (both audited).
-- UYGULANMADI: Neon/Preview/Production veritabanına uygulama.
ALTER TABLE "admin_users" DROP CONSTRAINT IF EXISTS "admin_users_role_ck";
--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_role_ck" CHECK ("admin_users"."role" IN ('super_admin','admin','owner','operations_manager','catalog_manager','support_agent','finance_manager','viewer'));
--> statement-breakpoint
ALTER TABLE "admin_invites" DROP CONSTRAINT IF EXISTS "admin_invites_role_ck";
--> statement-breakpoint
ALTER TABLE "admin_invites" ADD CONSTRAINT "admin_invites_role_ck" CHECK ("admin_invites"."role" IN ('super_admin','admin','operations_manager','catalog_manager','support_agent','finance_manager','viewer'));
--> statement-breakpoint
ALTER TABLE "admin_grants" DROP CONSTRAINT IF EXISTS "admin_grants_permission_ck";
--> statement-breakpoint
ALTER TABLE "admin_grants" ADD CONSTRAINT "admin_grants_permission_ck" CHECK ("admin_grants"."permission" IN ('catalog:write','orders:write','service:write','content:write','legal:write','admin:read','users:read','users:write','roles:write','integrations:read','integrations:write','payments:configure','security:write','audit:read','payments:record','payments:refund'));
