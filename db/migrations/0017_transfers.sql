-- Transfers and the one Ride each Transfer creates.
-- drizzle-kit emits the tables, ENABLE RLS, the policies, the unique indexes, and the audit check.
-- FORCE RLS and the grants are hand-written.
-- SELECT, INSERT, UPDATE only: there is no delete. A Ride is never deleted.
ALTER TYPE "app"."audit_action" ADD VALUE 'transfer.created' BEFORE 'roster.assigned';--> statement-breakpoint
CREATE UNIQUE INDEX "clients_tenant_id_id" ON "app"."clients" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_tenant_id_id" ON "app"."locations" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE TABLE "app"."transfers" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"pickup_at" timestamp with time zone NOT NULL,
	"start_location_id" uuid NOT NULL,
	"end_location_id" uuid NOT NULL,
	"passenger_count" integer NOT NULL,
	"guest_name" text NOT NULL,
	"flight_number" text,
	"price" numeric(10, 2) NOT NULL,
	"payment" text NOT NULL,
	"airport_mark" boolean NOT NULL,
	"luggage_count" integer NOT NULL,
	"child_seat_count" integer NOT NULL,
	"note" text,
	CONSTRAINT "transfers_passenger_count" CHECK ("app"."transfers"."passenger_count" between 1 and 60),
	CONSTRAINT "transfers_guest_name" CHECK ("app"."transfers"."guest_name" = btrim("app"."transfers"."guest_name") and length("app"."transfers"."guest_name") between 1 and 200),
	CONSTRAINT "transfers_flight_number" CHECK ("app"."transfers"."flight_number" is null or ("app"."transfers"."flight_number" = btrim("app"."transfers"."flight_number") and length("app"."transfers"."flight_number") between 1 and 20)),
	CONSTRAINT "transfers_price" CHECK ("app"."transfers"."price" >= 0),
	CONSTRAINT "transfers_payment" CHECK ("app"."transfers"."payment" in ('cash', 'card', 'invoice_to_agency')),
	CONSTRAINT "transfers_luggage_count" CHECK ("app"."transfers"."luggage_count" between 0 and 60),
	CONSTRAINT "transfers_child_seat_count" CHECK ("app"."transfers"."child_seat_count" between 0 and 10),
	CONSTRAINT "transfers_note" CHECK ("app"."transfers"."note" is null or ("app"."transfers"."note" = btrim("app"."transfers"."note") and length("app"."transfers"."note") between 1 and 1000))
);
--> statement-breakpoint
CREATE TABLE "app"."rides" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"state" text NOT NULL,
	"driver_id" uuid,
	"vehicle_id" uuid,
	CONSTRAINT "rides_state" CHECK ("app"."rides"."state" in ('unassigned', 'assigned', 'accepted', 'done', 'no-show', 'cancelled')),
	CONSTRAINT "rides_unassigned_open" CHECK ("app"."rides"."state" <> 'unassigned' or ("app"."rides"."driver_id" is null and "app"."rides"."vehicle_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_tenant_id_id" ON "app"."transfers" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "rides_transfer_id" ON "app"."rides" USING btree ("transfer_id");--> statement-breakpoint
ALTER TABLE "app"."transfers" ADD CONSTRAINT "transfers_client_fk" FOREIGN KEY ("tenant_id","client_id") REFERENCES "app"."clients"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "app"."transfers" ADD CONSTRAINT "transfers_start_location_fk" FOREIGN KEY ("tenant_id","start_location_id") REFERENCES "app"."locations"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "app"."transfers" ADD CONSTRAINT "transfers_end_location_fk" FOREIGN KEY ("tenant_id","end_location_id") REFERENCES "app"."locations"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "app"."rides" ADD CONSTRAINT "rides_transfer_fk" FOREIGN KEY ("tenant_id","transfer_id") REFERENCES "app"."transfers"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "app"."transfers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."rides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
    when 'driver.created' then "app"."audit_entry"."subject_user_id" is null and "app"."audit_entry"."data" - '{driverId,fields}'::text[] = '{}'::jsonb and jsonb_typeof("app"."audit_entry"."data" -> 'driverId') = 'string' and "app"."audit_entry"."data" ->> 'driverId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and jsonb_typeof("app"."audit_entry"."data" -> 'fields') = 'array' and jsonb_array_length("app"."audit_entry"."data" -> 'fields') between 1 and 7 and "app"."audit_entry"."data" -> 'fields' <@ '["name","kind","phone","drivingLicenceExpiresOn","transportLicenceExpiresOn","memberUserId","mustAccept"]'::jsonb
    when 'driver.field_changed' then "app"."audit_entry"."subject_user_id" is null and "app"."audit_entry"."data" - '{driverId,field}'::text[] = '{}'::jsonb and jsonb_typeof("app"."audit_entry"."data" -> 'driverId') = 'string' and "app"."audit_entry"."data" ->> 'driverId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and jsonb_typeof("app"."audit_entry"."data" -> 'field') = 'string' and "app"."audit_entry"."data" ->> 'field' in ('name', 'kind', 'phone', 'drivingLicenceExpiresOn', 'transportLicenceExpiresOn', 'memberUserId', 'mustAccept')
    when 'vehicle.created' then "app"."audit_entry"."subject_user_id" is null and "app"."audit_entry"."data" - '{vehicleId,fields}'::text[] = '{}'::jsonb and jsonb_typeof("app"."audit_entry"."data" -> 'vehicleId') = 'string' and "app"."audit_entry"."data" ->> 'vehicleId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and jsonb_typeof("app"."audit_entry"."data" -> 'fields') = 'array' and jsonb_array_length("app"."audit_entry"."data" -> 'fields') between 1 and 6 and "app"."audit_entry"."data" -> 'fields' <@ '["registrationPlate","kind","registrationExpiresOn","technicalInspectionExpiresOn","insuranceExpiresOn","description"]'::jsonb
    when 'vehicle.field_changed' then "app"."audit_entry"."subject_user_id" is null and "app"."audit_entry"."data" - '{vehicleId,field}'::text[] = '{}'::jsonb and jsonb_typeof("app"."audit_entry"."data" -> 'vehicleId') = 'string' and "app"."audit_entry"."data" ->> 'vehicleId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and jsonb_typeof("app"."audit_entry"."data" -> 'field') = 'string' and "app"."audit_entry"."data" ->> 'field' in ('registrationPlate', 'kind', 'registrationExpiresOn', 'technicalInspectionExpiresOn', 'insuranceExpiresOn', 'description')
    when 'vehicle.archived' then "app"."audit_entry"."subject_user_id" is null and "app"."audit_entry"."data" - '{vehicleId}'::text[] = '{}'::jsonb and jsonb_typeof("app"."audit_entry"."data" -> 'vehicleId') = 'string' and "app"."audit_entry"."data" ->> 'vehicleId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    when 'location.created' then "app"."audit_entry"."subject_user_id" is null and "app"."audit_entry"."data" - '{locationId,fields}'::text[] = '{}'::jsonb and jsonb_typeof("app"."audit_entry"."data" -> 'locationId') = 'string' and "app"."audit_entry"."data" ->> 'locationId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and jsonb_typeof("app"."audit_entry"."data" -> 'fields') = 'array' and jsonb_array_length("app"."audit_entry"."data" -> 'fields') between 1 and 3 and "app"."audit_entry"."data" -> 'fields' <@ '["name","kind","address"]'::jsonb
    when 'location.field_changed' then "app"."audit_entry"."subject_user_id" is null and "app"."audit_entry"."data" - '{locationId,field}'::text[] = '{}'::jsonb and jsonb_typeof("app"."audit_entry"."data" -> 'locationId') = 'string' and "app"."audit_entry"."data" ->> 'locationId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and jsonb_typeof("app"."audit_entry"."data" -> 'field') = 'string' and "app"."audit_entry"."data" ->> 'field' in ('name', 'kind', 'address')
    when 'location.archived' then "app"."audit_entry"."subject_user_id" is null and "app"."audit_entry"."data" - '{locationId}'::text[] = '{}'::jsonb and jsonb_typeof("app"."audit_entry"."data" -> 'locationId') = 'string' and "app"."audit_entry"."data" ->> 'locationId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    when 'transfer.created' then "app"."audit_entry"."subject_user_id" is null and "app"."audit_entry"."data" - '{transferId,rideId,clientId,startLocationId,endLocationId,fields}'::text[] = '{}'::jsonb and jsonb_typeof("app"."audit_entry"."data" -> 'transferId') = 'string' and "app"."audit_entry"."data" ->> 'transferId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and jsonb_typeof("app"."audit_entry"."data" -> 'rideId') = 'string' and "app"."audit_entry"."data" ->> 'rideId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and jsonb_typeof("app"."audit_entry"."data" -> 'clientId') = 'string' and "app"."audit_entry"."data" ->> 'clientId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and jsonb_typeof("app"."audit_entry"."data" -> 'startLocationId') = 'string' and "app"."audit_entry"."data" ->> 'startLocationId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and jsonb_typeof("app"."audit_entry"."data" -> 'endLocationId') = 'string' and "app"."audit_entry"."data" ->> 'endLocationId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and jsonb_typeof("app"."audit_entry"."data" -> 'fields') = 'array' and jsonb_array_length("app"."audit_entry"."data" -> 'fields') between 1 and 10 and "app"."audit_entry"."data" -> 'fields' <@ '["pickupAt","passengerCount","guestName","flightNumber","price","payment","airportMark","luggageCount","childSeatCount","note"]'::jsonb
    when 'roster.assigned' then "app"."audit_entry"."subject_user_id" is null and "app"."audit_entry"."data" - '{rosterDate,driverId,vehicleId}'::text[] = '{}'::jsonb and jsonb_typeof("app"."audit_entry"."data" -> 'rosterDate') = 'string' and "app"."audit_entry"."data" ->> 'rosterDate' ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' and jsonb_typeof("app"."audit_entry"."data" -> 'driverId') = 'string' and "app"."audit_entry"."data" ->> 'driverId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and jsonb_typeof("app"."audit_entry"."data" -> 'vehicleId') = 'string' and "app"."audit_entry"."data" ->> 'vehicleId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    when 'roster.changed' then "app"."audit_entry"."subject_user_id" is null and "app"."audit_entry"."data" - '{rosterDate,driverId,fromVehicleId,toVehicleId}'::text[] = '{}'::jsonb and jsonb_typeof("app"."audit_entry"."data" -> 'rosterDate') = 'string' and "app"."audit_entry"."data" ->> 'rosterDate' ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' and jsonb_typeof("app"."audit_entry"."data" -> 'driverId') = 'string' and "app"."audit_entry"."data" ->> 'driverId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and jsonb_typeof("app"."audit_entry"."data" -> 'fromVehicleId') = 'string' and "app"."audit_entry"."data" ->> 'fromVehicleId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and jsonb_typeof("app"."audit_entry"."data" -> 'toVehicleId') = 'string' and "app"."audit_entry"."data" ->> 'toVehicleId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    when 'roster.cleared' then "app"."audit_entry"."subject_user_id" is null and "app"."audit_entry"."data" - '{rosterDate,driverId,vehicleId}'::text[] = '{}'::jsonb and jsonb_typeof("app"."audit_entry"."data" -> 'rosterDate') = 'string' and "app"."audit_entry"."data" ->> 'rosterDate' ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' and jsonb_typeof("app"."audit_entry"."data" -> 'driverId') = 'string' and "app"."audit_entry"."data" ->> 'driverId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and jsonb_typeof("app"."audit_entry"."data" -> 'vehicleId') = 'string' and "app"."audit_entry"."data" ->> 'vehicleId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    when 'tenant.renamed' then "app"."audit_entry"."subject_user_id" is null and "app"."audit_entry"."data" = '{}'::jsonb
    when 'tenant.suspended' then "app"."audit_entry"."subject_user_id" is null and "app"."audit_entry"."data" = '{}'::jsonb
    when 'tenant.reactivated' then "app"."audit_entry"."subject_user_id" is null and "app"."audit_entry"."data" = '{}'::jsonb
    else false end) is true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "app"."transfers" AS PERMISSIVE FOR ALL TO "transferpro_app" USING ("app"."transfers"."tenant_id" = app.current_tenant_id()) WITH CHECK ("app"."transfers"."tenant_id" = app.current_tenant_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "app"."rides" AS PERMISSIVE FOR ALL TO "transferpro_app" USING ("app"."rides"."tenant_id" = app.current_tenant_id()) WITH CHECK ("app"."rides"."tenant_id" = app.current_tenant_id());
--> statement-breakpoint
-- drizzle-kit cannot emit FORCE RLS or these grants. There is no delete.
ALTER TABLE "app"."transfers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."rides" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "app"."transfers" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE "app"."rides" FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "app"."transfers" TO "transferpro_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "app"."rides" TO "transferpro_app";
