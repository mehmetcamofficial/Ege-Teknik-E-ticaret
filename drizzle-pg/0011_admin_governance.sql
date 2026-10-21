CREATE TABLE "admin_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_user_id" text NOT NULL,
	"permission" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"granted_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_grants_no_payments_configure_ck" CHECK ("admin_grants"."permission" <> 'payments:configure'),
	CONSTRAINT "admin_grants_permission_ck" CHECK ("admin_grants"."permission" IN ('catalog:write','orders:write','service:write','content:write','legal:write','admin:read','users:read','users:write','roles:write','integrations:read','integrations:write','payments:configure','security:write','audit:read')),
	CONSTRAINT "admin_grants_expiry_ck" CHECK ("admin_grants"."expires_at" > "admin_grants"."created_at" AND "admin_grants"."expires_at" <= "admin_grants"."created_at" + make_interval(hours => 168))
);
--> statement-breakpoint
CREATE TABLE "admin_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"invited_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_invites_token_ck" CHECK ("admin_invites"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "admin_invites_role_ck" CHECK ("admin_invites"."role" IN ('super_admin','admin','operations_manager','catalog_manager','support_agent','viewer')),
	CONSTRAINT "admin_invites_expiry_ck" CHECK ("admin_invites"."expires_at" > "admin_invites"."created_at" AND "admin_invites"."expires_at" <= "admin_invites"."created_at" + make_interval(hours => 72))
);
--> statement-breakpoint
CREATE TABLE "integration_configs" (
	"key" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"configured" boolean DEFAULT false NOT NULL,
	"hint" text DEFAULT '' NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_configs_hint_ck" CHECK (char_length("integration_configs"."hint") <= 32)
);
--> statement-breakpoint
ALTER TABLE "admin_grants" ADD CONSTRAINT "admin_grants_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_grants" ADD CONSTRAINT "admin_grants_granted_by_admin_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_invites" ADD CONSTRAINT "admin_invites_invited_by_admin_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_configs" ADD CONSTRAINT "integration_configs_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_grants_user_expiry_idx" ON "admin_grants" USING btree ("admin_user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_invites_token_uq" ON "admin_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "admin_invites_email_created_idx" ON "admin_invites" USING btree ("email","created_at");
--> statement-breakpoint
-- Reviewed owner-consolidation + owner-retirement (kept verbatim from the approved review):
-- Block 0: fail-closed in-migration owner-count guard (exactly-1-active-owner, resume-tolerant).
DO $$ DECLARE
  active_owner_count int;
  consolidation_count int;
BEGIN
  SELECT count(*) INTO active_owner_count FROM "admin_users" WHERE "role" = 'owner' AND "active" = true;
  SELECT count(*) INTO consolidation_count FROM "audit_logs"
    WHERE "action" = 'role_change' AND "entity_type" = 'admin_user'
      AND ("payload"->>'reason' = 'phase_6d1_owner_consolidation');
  IF active_owner_count = 1 THEN
    RETURN;
  ELSIF active_owner_count = 0 AND consolidation_count >= 1 THEN
    RETURN;
  ELSIF active_owner_count = 0 THEN
    RAISE EXCEPTION 'abort 0011: 0 active owners found; refusing to invent a privileged identity (preflight Q1 must show exactly 1)'
      USING ERRCODE = 'restrict_violation';
  ELSE
    RAISE EXCEPTION 'abort 0011: % active owners found; refusing bulk promotion (preflight Q1 must show exactly 1)', active_owner_count
      USING ERRCODE = 'restrict_violation';
  END IF;
END $$;
--> statement-breakpoint
-- Block 1: promote the single active owner to super_admin (idempotent; FKs keep the same id).
DO $$ DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id, email FROM "admin_users" WHERE "role" = 'owner' AND "active" = true LOOP
    UPDATE "admin_users" SET "role" = 'super_admin', "updated_at" = now() WHERE "id" = r.id;
    INSERT INTO "audit_logs" ("id","actor_user_id","actor_email","action","entity_type","entity_id","payload")
    VALUES (
      '0011-role-consolidation-' || r.id,
      r.id,
      r.email,
      'role_change',
      'admin_user',
      r.id,
      jsonb_build_object('from','owner','to','super_admin','reason','phase_6d1_owner_consolidation','automatic',true)
    )
    ON CONFLICT ("id") DO NOTHING;
  END LOOP;
END $$;
--> statement-breakpoint
-- Block 2: role allow-list INCLUDING legacy 'owner' so grandfathered inactive owner rows validate.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_users_role_ck') THEN
    ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_role_ck"
      CHECK ("role" IN ('super_admin','admin','owner','operations_manager','catalog_manager','support_agent','viewer'));
  END IF;
END $$;
--> statement-breakpoint
-- Block 3: retire 'owner' via trigger (a value-excluding CHECK would fail on grandfathered rows).
CREATE OR REPLACE FUNCTION "admin_users_retire_owner_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW."role" = 'owner' THEN
    RAISE EXCEPTION 'retired role: new owner accounts are disabled; invite as super_admin/admin instead'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."role" = 'owner' AND OLD."role" IS DISTINCT FROM 'owner' THEN
      RAISE EXCEPTION 'retired role: conversion to owner is disabled; convert to an allowed role instead'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD."role" = 'owner' AND NEW."role" = 'owner' AND OLD."active" = false AND NEW."active" = true THEN
      RAISE EXCEPTION 'retired role: inactive owner cannot be reactivated as owner; convert to super_admin/admin first, then activate'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "admin_users_retire_owner_trg" ON "admin_users";
--> statement-breakpoint
CREATE TRIGGER "admin_users_retire_owner_trg" BEFORE INSERT OR UPDATE ON "admin_users"
  FOR EACH ROW EXECUTE FUNCTION "admin_users_retire_owner_guard"();