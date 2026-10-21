-- ADR-0049 allows the daily job to delete contact persons removed more than 90 days ago.
-- The grant is on app.client_contact_persons only, for the app role the job runs as.
-- The restrictive policy holds every delete to rows removed more than 90 days ago.
CREATE POLICY "client_contact_persons_retention_delete" ON "app"."client_contact_persons" AS RESTRICTIVE FOR DELETE TO "transferpro_app" USING ("app"."client_contact_persons"."removed_at" < now() - interval '90 days');
--> statement-breakpoint
GRANT DELETE ON TABLE "app"."client_contact_persons" TO "transferpro_app";
--> statement-breakpoint
-- The daily tick lists the Tenants that hold a person removed before the cutoff,
-- so it can open one session per Tenant. It returns Tenant ids only.
CREATE FUNCTION "app"."tenants_with_contact_persons_removed_before"(p_before timestamp with time zone)
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  select distinct p.tenant_id
  from app.client_contact_persons as p
  where p.removed_at < p_before
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."tenants_with_contact_persons_removed_before"(timestamp with time zone) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."tenants_with_contact_persons_removed_before"(timestamp with time zone) TO "transferpro_app";
