-- ADR-0017. drizzle-kit emits the table, ENABLE RLS, the policy, and the audit check.
-- FORCE RLS and the grant are hand-written, SELECT, INSERT, UPDATE only: there is no delete.
ALTER TYPE "app"."audit_action" ADD VALUE 'client.created';--> statement-breakpoint
ALTER TYPE "app"."audit_action" ADD VALUE 'client.name_changed';--> statement-breakpoint
ALTER TYPE "app"."audit_action" ADD VALUE 'client.kind_changed';--> statement-breakpoint
CREATE TABLE "app"."clients" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "clients_name" CHECK ("app"."clients"."name" = btrim("app"."clients"."name") and length("app"."clients"."name") between 1 and 200),
	CONSTRAINT "clients_kind" CHECK ("app"."clients"."kind" in ('agency', 'hotel', 'individual'))
);
--> statement-breakpoint
ALTER TABLE "app"."clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."audit_entry" DROP CONSTRAINT "audit_entry_shape";--> statement-breakpoint
ALTER TABLE "app"."audit_entry" ADD CONSTRAINT "audit_entry_shape" CHECK ((case "app"."audit_entry"."action"::text
    when 'member.invited' then "app"."audit_entry"."subject_user_id" is null and "app"."audit_entry"."data" - '{role}'::text[] = '{}'::jsonb and "app"."audit_entry"."data" ->> 'role' in ('admin', 'dispatcher', 'driver')
    when 'member.role_changed' then "app"."audit_entry"."subject_user_id" <> '' and "app"."audit_entry"."data" - '{from,to}'::text[] = '{}'::jsonb and "app"."audit_entry"."data" ->> 'from' in ('admin', 'dispatcher', 'driver') and "app"."audit_entry"."data" ->> 'to' in ('admin', 'dispatcher', 'driver')
    when 'member.removed' then "app"."audit_entry"."subject_user_id" <> '' and "app"."audit_entry"."data" - '{role}'::text[] = '{}'::jsonb and "app"."audit_entry"."data" ->> 'role' in ('admin', 'dispatcher', 'driver')
    when 'settings.airport_wait_changed' then "app"."audit_entry"."subject_user_id" is null and "app"."audit_entry"."data" - '{from,to}'::text[] = '{}'::jsonb and (case when jsonb_typeof("app"."audit_entry"."data" -> 'from') = 'number' and ("app"."audit_entry"."data" ->> 'from') ~ '^[0-9]+$' then ("app"."audit_entry"."data" ->> 'from')::integer between 1 and 1440 else false end) and (case when jsonb_typeof("app"."audit_entry"."data" -> 'to') = 'number' and ("app"."audit_entry"."data" ->> 'to') ~ '^[0-9]+$' then ("app"."audit_entry"."data" ->> 'to')::integer between 1 and 1440 else false end)
    when 'settings.elsewhere_wait_changed' then "app"."audit_entry"."subject_user_id" is null and "app"."audit_entry"."data" - '{from,to}'::text[] = '{}'::jsonb and (case when jsonb_typeof("app"."audit_entry"."data" -> 'from') = 'number' and ("app"."audit_entry"."data" ->> 'from') ~ '^[0-9]+$' then ("app"."audit_entry"."data" ->> 'from')::integer between 1 and 1440 else false end) and (case when jsonb_typeof("app"."audit_entry"."data" -> 'to') = 'number' and ("app"."audit_entry"."data" ->> 'to') ~ '^[0-9]+$' then ("app"."audit_entry"."data" ->> 'to')::integer between 1 and 1440 else false end)
    when 'settings.time_zone_changed' then "app"."audit_entry"."subject_user_id" is null and "app"."audit_entry"."data" - '{from,to}'::text[] = '{}'::jsonb and jsonb_typeof("app"."audit_entry"."data" -> 'from') = 'string' and length("app"."audit_entry"."data" ->> 'from') between 1 and 64 and jsonb_typeof("app"."audit_entry"."data" -> 'to') = 'string' and length("app"."audit_entry"."data" ->> 'to') between 1 and 64
    when 'client.created' then "app"."audit_entry"."subject_user_id" is null and "app"."audit_entry"."data" - '{clientId,kind}'::text[] = '{}'::jsonb and jsonb_typeof("app"."audit_entry"."data" -> 'clientId') = 'string' and "app"."audit_entry"."data" ->> 'clientId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and "app"."audit_entry"."data" ->> 'kind' in ('agency', 'hotel', 'individual')
    when 'client.name_changed' then "app"."audit_entry"."subject_user_id" is null and "app"."audit_entry"."data" - '{clientId}'::text[] = '{}'::jsonb and jsonb_typeof("app"."audit_entry"."data" -> 'clientId') = 'string' and "app"."audit_entry"."data" ->> 'clientId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    when 'client.kind_changed' then "app"."audit_entry"."subject_user_id" is null and "app"."audit_entry"."data" - '{clientId,from,to}'::text[] = '{}'::jsonb and jsonb_typeof("app"."audit_entry"."data" -> 'clientId') = 'string' and "app"."audit_entry"."data" ->> 'clientId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and "app"."audit_entry"."data" ->> 'from' in ('agency', 'hotel', 'individual') and "app"."audit_entry"."data" ->> 'to' in ('agency', 'hotel', 'individual')
    else false end) is true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "app"."clients" AS PERMISSIVE FOR ALL TO "transferpro_app" USING ("app"."clients"."tenant_id" = app.current_tenant_id()) WITH CHECK ("app"."clients"."tenant_id" = app.current_tenant_id());
--> statement-breakpoint
-- drizzle-kit cannot emit FORCE RLS or this grant. There is no delete route in this ticket.
ALTER TABLE "app"."clients" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "app"."clients" FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "app"."clients" TO "transferpro_app";
