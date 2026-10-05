-- Vehicles. drizzle-kit emits the table, ENABLE RLS, the policy, and the audit check.
-- FORCE RLS and the grant are hand-written.
-- SELECT, INSERT, UPDATE only: there is no delete. Archive sets archived_at.
-- The expiry columns are date: a calendar day, no time and no zone.
ALTER TYPE "app"."audit_action" ADD VALUE 'vehicle.created';--> statement-breakpoint
ALTER TYPE "app"."audit_action" ADD VALUE 'vehicle.field_changed';--> statement-breakpoint
ALTER TYPE "app"."audit_action" ADD VALUE 'vehicle.archived';--> statement-breakpoint
CREATE TABLE "app"."vehicles" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_plate" text NOT NULL,
	"kind" text NOT NULL,
	"registration_expires_on" date NOT NULL,
	"technical_inspection_expires_on" date NOT NULL,
	"insurance_expires_on" date NOT NULL,
	"description" text,
	"archived_at" timestamp with time zone,
	CONSTRAINT "vehicles_registration_plate" CHECK ("app"."vehicles"."registration_plate" = upper(regexp_replace(btrim("app"."vehicles"."registration_plate"), '\s+', '', 'g')) and length("app"."vehicles"."registration_plate") between 1 and 16),
	CONSTRAINT "vehicles_kind" CHECK ("app"."vehicles"."kind" in ('fixed', 'occasional')),
	CONSTRAINT "vehicles_description" CHECK ("app"."vehicles"."description" is null or ("app"."vehicles"."description" = btrim("app"."vehicles"."description") and length("app"."vehicles"."description") between 1 and 120))
);
--> statement-breakpoint
ALTER TABLE "app"."vehicles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."audit_entry" DROP CONSTRAINT "audit_entry_shape";--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_plate_active" ON "app"."vehicles" USING btree ("tenant_id","registration_plate") WHERE "app"."vehicles"."archived_at" is null;--> statement-breakpoint
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
    when 'driver.created' then "app"."audit_entry"."subject_user_id" is null and "app"."audit_entry"."data" - '{driverId,fields}'::text[] = '{}'::jsonb and jsonb_typeof("app"."audit_entry"."data" -> 'driverId') = 'string' and "app"."audit_entry"."data" ->> 'driverId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and jsonb_typeof("app"."audit_entry"."data" -> 'fields') = 'array' and jsonb_array_length("app"."audit_entry"."data" -> 'fields') between 1 and 7 and "app"."audit_entry"."data" -> 'fields' <@ '["name","kind","phone","drivingLicenceExpiresOn","transportLicenceExpiresOn","memberUserId","mustAccept"]'::jsonb
    when 'driver.field_changed' then "app"."audit_entry"."subject_user_id" is null and "app"."audit_entry"."data" - '{driverId,field}'::text[] = '{}'::jsonb and jsonb_typeof("app"."audit_entry"."data" -> 'driverId') = 'string' and "app"."audit_entry"."data" ->> 'driverId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and jsonb_typeof("app"."audit_entry"."data" -> 'field') = 'string' and "app"."audit_entry"."data" ->> 'field' in ('name', 'kind', 'phone', 'drivingLicenceExpiresOn', 'transportLicenceExpiresOn', 'memberUserId', 'mustAccept')
    when 'vehicle.created' then "app"."audit_entry"."subject_user_id" is null and "app"."audit_entry"."data" - '{vehicleId,fields}'::text[] = '{}'::jsonb and jsonb_typeof("app"."audit_entry"."data" -> 'vehicleId') = 'string' and "app"."audit_entry"."data" ->> 'vehicleId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and jsonb_typeof("app"."audit_entry"."data" -> 'fields') = 'array' and jsonb_array_length("app"."audit_entry"."data" -> 'fields') between 1 and 6 and "app"."audit_entry"."data" -> 'fields' <@ '["registrationPlate","kind","registrationExpiresOn","technicalInspectionExpiresOn","insuranceExpiresOn","description"]'::jsonb
    when 'vehicle.field_changed' then "app"."audit_entry"."subject_user_id" is null and "app"."audit_entry"."data" - '{vehicleId,field}'::text[] = '{}'::jsonb and jsonb_typeof("app"."audit_entry"."data" -> 'vehicleId') = 'string' and "app"."audit_entry"."data" ->> 'vehicleId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and jsonb_typeof("app"."audit_entry"."data" -> 'field') = 'string' and "app"."audit_entry"."data" ->> 'field' in ('registrationPlate', 'kind', 'registrationExpiresOn', 'technicalInspectionExpiresOn', 'insuranceExpiresOn', 'description')
    when 'vehicle.archived' then "app"."audit_entry"."subject_user_id" is null and "app"."audit_entry"."data" - '{vehicleId}'::text[] = '{}'::jsonb and jsonb_typeof("app"."audit_entry"."data" -> 'vehicleId') = 'string' and "app"."audit_entry"."data" ->> 'vehicleId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    else false end) is true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "app"."vehicles" AS PERMISSIVE FOR ALL TO "transferpro_app" USING ("app"."vehicles"."tenant_id" = app.current_tenant_id()) WITH CHECK ("app"."vehicles"."tenant_id" = app.current_tenant_id());
--> statement-breakpoint
-- drizzle-kit cannot emit FORCE RLS or this grant. There is no delete route in this ticket.
ALTER TABLE "app"."vehicles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "app"."vehicles" FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "app"."vehicles" TO "transferpro_app";
