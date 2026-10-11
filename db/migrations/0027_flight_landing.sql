-- The actual landing time. Empty until the aircraft has landed.
-- The feed writes it only while it is empty. A future instant is refused
-- in the application: this column cannot see "now".
-- The function returns Tenant ids only, so the schedule can open one
-- session per Tenant without a request and without a flight number.
ALTER TABLE "app"."transfers" ADD COLUMN "landing_at" timestamp with time zone;
--> statement-breakpoint
CREATE FUNCTION "app"."tenants_due_flight_landing"(p_now timestamp with time zone)
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  select distinct t.tenant_id
  from app.transfers as t
  join app.rides as r
    on r.transfer_id = t.id and r.tenant_id = t.tenant_id
  join app.locations as l
    on l.id = t.start_location_id and l.tenant_id = t.tenant_id
  where r.state in ('unassigned', 'assigned', 'accepted')
    and t.airport_mark
    and t.landing_at is null
    and l.iata is not null
    and t.flight_number ~ '^[A-Za-z]{2,3} ?[0-9]{1,4}$'
    and t.pickup_at <= p_now + interval '12 hours'
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."tenants_due_flight_landing"(timestamp with time zone) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."tenants_due_flight_landing"(timestamp with time zone) TO "transferpro_app";
