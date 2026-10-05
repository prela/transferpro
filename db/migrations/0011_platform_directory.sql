-- ADR-0019. Column grants only. There is no DELETE anywhere in this file.
-- The platform role can list a firm and rename its display name.
-- It cannot insert a firm, change the slug, or read logo or metadata.
GRANT USAGE ON SCHEMA "auth" TO "transferpro_platform";
--> statement-breakpoint
GRANT SELECT ("id", "name", "slug", "created_at") ON TABLE "auth"."organization" TO "transferpro_platform";
--> statement-breakpoint
GRANT UPDATE ("name") ON TABLE "auth"."organization" TO "transferpro_platform";
--> statement-breakpoint
-- Absence of a row means the firm is active, so a Tenant created earlier stays active.
-- suspended_at is not granted: presence of organization_id is the whole flag.
-- Neither runtime role can insert or delete. The operator script uses the migrator.
CREATE TABLE "platform"."tenant_account" (
  "organization_id" text PRIMARY KEY REFERENCES "auth"."organization" ("id") ON DELETE CASCADE,
  "suspended_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
REVOKE ALL ON TABLE "platform"."tenant_account" FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ("organization_id") ON TABLE "platform"."tenant_account" TO "transferpro_platform";
--> statement-breakpoint
GRANT SELECT ("organization_id") ON TABLE "platform"."tenant_account" TO "transferpro_auth";
