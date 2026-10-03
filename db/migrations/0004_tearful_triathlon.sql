CREATE VIEW "app"."tenant_invitation" WITH (security_barrier = true, security_invoker = false) AS (
  select "auth"."invitation"."id", "auth"."invitation"."role", "auth"."invitation"."status", "auth"."invitation"."expires_at"
  from "auth"."invitation"
  where "auth"."invitation"."organization_id" = app.current_tenant_id()::text
);
--> statement-breakpoint
REVOKE ALL ON "app"."tenant_invitation" FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON "app"."tenant_invitation" TO "transferpro_app";