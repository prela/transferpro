-- drizzle-kit does not emit the session function, schema grants, or FORCE RLS.
-- The table default and the policy both call app.current_tenant_id().
CREATE SCHEMA "app";
--> statement-breakpoint
REVOKE ALL ON SCHEMA "app" FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "app" TO "transferpro_app";
--> statement-breakpoint
CREATE FUNCTION "app"."current_tenant_id"() RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."current_tenant_id"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."current_tenant_id"() TO "transferpro_app";
--> statement-breakpoint
CREATE TABLE "app"."tenant_settings" (
	"tenant_id" uuid PRIMARY KEY DEFAULT app.current_tenant_id() NOT NULL,
	"default_locale" text NOT NULL,
	"time_zone" text NOT NULL,
	CONSTRAINT "tenant_settings_default_locale" CHECK ("app"."tenant_settings"."default_locale" in ('hr', 'en'))
);
--> statement-breakpoint
ALTER TABLE "app"."tenant_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."tenant_settings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "app"."tenant_settings" AS PERMISSIVE FOR ALL TO "transferpro_app" USING ("app"."tenant_settings"."tenant_id" = app.current_tenant_id()) WITH CHECK ("app"."tenant_settings"."tenant_id" = app.current_tenant_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "app"."tenant_settings" TO "transferpro_app";
