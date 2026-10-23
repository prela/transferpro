-- The nightly place-reference tick lists Tenants that have a due google
-- reference, so it can open one session per Tenant. It returns Tenant ids
-- only. The due rule matches the per-Tenant select: active, provider google,
-- and unchecked or last checked more than 12 months before the tick.
CREATE FUNCTION "app"."tenants_due_place_refresh"(p_now timestamp with time zone)
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  select distinct l.tenant_id
  from app.locations as l
  where l.archived_at is null
    and l.place_provider = 'google'
    and l.place_ref is not null
    and (
      l.place_ref_checked_at is null
      or l.place_ref_checked_at < p_now - interval '12 months'
    )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."tenants_due_place_refresh"(timestamp with time zone) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."tenants_due_place_refresh"(timestamp with time zone) TO "transferpro_app";
