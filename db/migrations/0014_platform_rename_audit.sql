-- 0012 granted transferpro_platform EXECUTE on audit.append_entry. That function
-- takes any action and any data, so a leaked platform URL could append a
-- shaped row for whichever Tenant is in app.tenant_id. Rename uses the
-- wrapper below. The owner role still calls append_entry for the lever.
REVOKE EXECUTE ON FUNCTION "audit"."append_entry"(text, text, text, jsonb) FROM "transferpro_platform";
--> statement-breakpoint
-- Fixed action and data. The Tenant is the caller's app.tenant_id, read
-- inside append_entry. search_path excludes the caller's schema.
CREATE FUNCTION "audit"."append_tenant_renamed"(p_actor_user_id text) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM audit.append_entry('tenant.renamed', p_actor_user_id, NULL, '{}'::jsonb);
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "audit"."append_tenant_renamed"(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "audit"."append_tenant_renamed"(text) TO "transferpro_platform";
