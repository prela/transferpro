-- The day read joins the author and requires the same tenant on that join.
-- app.tenant_member had no tenant column. Organization ids are the tenant
-- uuid stored as text. Adding a column at the end keeps the existing view.
-- Dropping the column reverses this: recreate the view without tenant_id.
CREATE OR REPLACE VIEW "app"."tenant_member" WITH (security_barrier = true, security_invoker = false) AS (
  select "auth"."member"."user_id", "auth"."user"."name", "auth"."member"."role", "auth"."member"."organization_id"::uuid as tenant_id
  from "auth"."member"
  inner join "auth"."user" on "auth"."user"."id" = "auth"."member"."user_id"
  where "auth"."member"."organization_id" = app.current_tenant_id()::text
);
