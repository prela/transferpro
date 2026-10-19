-- ADR-0045 allows a scheduled job to delete outbox entries older than 90 days.
-- The grant is on app.mail_outbox only, for the app role the job runs as.
-- The row policy keeps each delete inside one Tenant.
GRANT DELETE ON TABLE "app"."mail_outbox" TO "transferpro_app";
--> statement-breakpoint
-- The daily tick lists the Tenants that hold an entry older than the cutoff,
-- so it can open one session per Tenant. It returns Tenant ids only.
CREATE FUNCTION "app"."tenants_with_mail_outbox_before"(p_before timestamp with time zone)
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  select distinct o.tenant_id
  from app.mail_outbox as o
  where o.created_at < p_before
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."tenants_with_mail_outbox_before"(timestamp with time zone) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."tenants_with_mail_outbox_before"(timestamp with time zone) TO "transferpro_app";
