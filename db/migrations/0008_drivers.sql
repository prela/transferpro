-- Drivers. drizzle-kit emits the table, ENABLE RLS, the policy, and the audit check.
-- FORCE RLS, the grant, and the member trigger are hand-written.
-- SELECT, INSERT, UPDATE only: there is no delete.
-- The licence columns are date: a calendar day, no time and no zone.
ALTER TYPE "app"."audit_action" ADD VALUE 'driver.created';--> statement-breakpoint
ALTER TYPE "app"."audit_action" ADD VALUE 'driver.field_changed';--> statement-breakpoint
CREATE TABLE "app"."drivers" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"phone" text NOT NULL,
	"driving_licence_expires_on" date NOT NULL,
	"transport_licence_expires_on" date NOT NULL,
	"member_user_id" text,
	"must_accept" boolean DEFAULT false NOT NULL,
	CONSTRAINT "drivers_name" CHECK ("app"."drivers"."name" = btrim("app"."drivers"."name") and length("app"."drivers"."name") between 1 and 200),
	CONSTRAINT "drivers_kind" CHECK ("app"."drivers"."kind" in ('own', 'external')),
	CONSTRAINT "drivers_phone" CHECK ("app"."drivers"."phone" = btrim("app"."drivers"."phone") and length("app"."drivers"."phone") between 1 and 40),
	CONSTRAINT "drivers_member_user_id" CHECK ("app"."drivers"."member_user_id" is null or ("app"."drivers"."member_user_id" = btrim("app"."drivers"."member_user_id") and length("app"."drivers"."member_user_id") between 1 and 64))
);
--> statement-breakpoint
ALTER TABLE "app"."drivers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."audit_entry" DROP CONSTRAINT "audit_entry_shape";--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_one_member" ON "app"."drivers" USING btree ("tenant_id","member_user_id") WHERE "app"."drivers"."member_user_id" is not null;--> statement-breakpoint
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
    else false end) is true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "app"."drivers" AS PERMISSIVE FOR ALL TO "transferpro_app" USING ("app"."drivers"."tenant_id" = app.current_tenant_id()) WITH CHECK ("app"."drivers"."tenant_id" = app.current_tenant_id());
--> statement-breakpoint
-- drizzle-kit cannot emit FORCE RLS or this grant. There is no delete route in this ticket.
ALTER TABLE "app"."drivers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "app"."drivers" FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "app"."drivers" TO "transferpro_app";
--> statement-breakpoint
-- The app role cannot read auth.member. app.tenant_member already hides every
-- other Tenant, so a link to a member of Tenant B fails while the session is Tenant A.
-- A member of this Tenant whose role is not driver fails the same check.
CREATE FUNCTION "app"."drivers_member_is_driver"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
  IF NEW.member_user_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM app.tenant_member
    WHERE user_id = NEW.member_user_id
      AND role = 'driver'
  ) THEN
    RAISE EXCEPTION 'driver member is not a driver of this tenant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."drivers_member_is_driver"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."drivers_member_is_driver"() TO "transferpro_app";
--> statement-breakpoint
CREATE TRIGGER "drivers_member_is_driver"
  BEFORE INSERT OR UPDATE OF member_user_id ON "app"."drivers"
  FOR EACH ROW
  EXECUTE FUNCTION "app"."drivers_member_is_driver"();