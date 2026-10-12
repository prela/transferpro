-- The designator will not arrive at this airport, and whether that fact
-- has been handed. A handed row drops out of the ask. An unhanded row
-- stays due so the next ask can tell a Driver who was assigned later,
-- without calling the status port again.
ALTER TABLE "app"."transfers" ADD COLUMN "flight_will_not_arrive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."transfers" ADD COLUMN "flight_will_not_arrive_handed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app"."tenants_due_flight_landing"(p_now timestamp with time zone)
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
    and t.flight_will_not_arrive_handed = false
$$;