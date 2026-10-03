-- ADR-0014. drizzle-kit emits the type, the table, ENABLE RLS, the index, and the policy.
-- The rest is hand-written: FORCE RLS, grants, functions, and triggers.
CREATE TYPE "app"."audit_action" AS ENUM('member.invited', 'member.role_changed', 'member.removed');--> statement-breakpoint
CREATE TABLE "app"."audit_entry" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" "app"."audit_action" NOT NULL,
	"subject_user_id" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "audit_entry_actor_user_id" CHECK ("app"."audit_entry"."actor_user_id" <> ''),
	CONSTRAINT "audit_entry_data" CHECK (jsonb_typeof("app"."audit_entry"."data") = 'object')
);
--> statement-breakpoint
ALTER TABLE "app"."audit_entry" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "audit_entry_tenant_occurred_at" ON "app"."audit_entry" USING btree ("tenant_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "app"."audit_entry" AS PERMISSIVE FOR ALL TO "transferpro_app" USING ("app"."audit_entry"."tenant_id" = app.current_tenant_id()) WITH CHECK ("app"."audit_entry"."tenant_id" = app.current_tenant_id());
--> statement-breakpoint
ALTER TABLE "app"."audit_entry" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The app role reads. No role is granted INSERT, UPDATE, DELETE, or TRUNCATE.
REVOKE ALL ON TABLE "app"."audit_entry" FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON TABLE "app"."audit_entry" TO "transferpro_app";
--> statement-breakpoint
-- A statement trigger, so it fires even when no row matches, and for the owner too.
CREATE FUNCTION "app"."refuse_audit_change"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'app.audit_entry is append-only' USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."refuse_audit_change"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "audit_entry_append_only" BEFORE UPDATE OR DELETE OR TRUNCATE ON "app"."audit_entry" FOR EACH STATEMENT EXECUTE FUNCTION "app"."refuse_audit_change"();
--> statement-breakpoint
-- Schema audit holds the write path. The auth role reaches it without any grant on schema app.
CREATE SCHEMA "audit";
--> statement-breakpoint
REVOKE ALL ON SCHEMA "audit" FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "audit" TO "transferpro_app", "transferpro_auth";
--> statement-breakpoint
-- Runs as the owner, which has BYPASSRLS. The Tenant is the caller's app.tenant_id, never a parameter.
CREATE FUNCTION "audit"."append_entry"(p_action text, p_actor_user_id text, p_subject_user_id text, p_data jsonb) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  tenant uuid := app.current_tenant_id();
BEGIN
  IF tenant IS NULL THEN
    RAISE EXCEPTION 'audit entry without app.tenant_id' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO app.audit_entry (tenant_id, action, actor_user_id, subject_user_id, data)
  VALUES (tenant, p_action::app.audit_action, p_actor_user_id, p_subject_user_id, p_data);
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "audit"."append_entry"(text, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "audit"."append_entry"(text, text, text, jsonb) TO "transferpro_app", "transferpro_auth";
--> statement-breakpoint
-- Better Auth inserts the invitation on its own connection. This trigger writes the
-- entry in that statement's transaction. A role the log cannot show refuses the insert.
CREATE FUNCTION "audit"."record_invitation"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.role IS NULL OR NEW.role NOT IN ('admin', 'dispatcher', 'driver') THEN
    RAISE EXCEPTION 'invitation role is not a Tenant role' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO app.audit_entry (tenant_id, action, actor_user_id, data)
  VALUES (NEW.organization_id::uuid, 'member.invited', NEW.inviter_id, jsonb_build_object('role', NEW.role));
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "audit"."record_invitation"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "audit_member_invited" AFTER INSERT ON "auth"."invitation" FOR EACH ROW EXECUTE FUNCTION "audit"."record_invitation"();
