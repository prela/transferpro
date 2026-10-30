-- When the status job last read this invoice. Null until the first read.
-- No default and no UPDATE, so existing rows are not rewritten.
-- The tick lists Tenants that have a created or cancelling invoice.
-- It returns Tenant ids only.
ALTER TABLE "app"."invoices" ADD COLUMN "status_checked_at" timestamp with time zone;
--> statement-breakpoint
CREATE FUNCTION "app"."tenants_due_invoice_status"()
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  select distinct i.tenant_id
  from app.invoices as i
  where i.state in ('created', 'cancelling')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."tenants_due_invoice_status"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."tenants_due_invoice_status"() TO "transferpro_app";