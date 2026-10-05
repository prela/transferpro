-- ADR-0019. A superadmin is a user id, not a membership and not a role.
-- No password is stored here. docker/postgres/init-roles.sh creates the login.
-- The migration refuses to continue when that role was not created first.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'transferpro_platform') THEN
    RAISE EXCEPTION 'transferpro_platform is missing';
  END IF;
END
$$;
--> statement-breakpoint
CREATE SCHEMA "platform";
--> statement-breakpoint
REVOKE ALL ON SCHEMA "platform" FROM PUBLIC;
--> statement-breakpoint
-- The auth role reads the grant. The platform role reads the directory.
GRANT USAGE ON SCHEMA "platform" TO "transferpro_platform", "transferpro_auth";
--> statement-breakpoint
CREATE TABLE "platform"."superadmin" (
  "user_id" text PRIMARY KEY REFERENCES "auth"."user" ("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
REVOKE ALL ON TABLE "platform"."superadmin" FROM PUBLIC;
--> statement-breakpoint
-- user_id only. created_at stays unread, and this role cannot insert.
GRANT SELECT ("user_id") ON TABLE "platform"."superadmin" TO "transferpro_auth";
--> statement-breakpoint
-- Runs as the migrator, so the auth role does not need to read the table itself.
-- search_path excludes the caller's schema: names below are schema-qualified.
CREATE FUNCTION "platform"."refuse_superadmin_membership"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM platform.superadmin WHERE user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'a superadmin cannot be a tenant member' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "platform"."refuse_superadmin_membership"() FROM PUBLIC;
--> statement-breakpoint
-- Invitation accept and tenant:create insert members as transferpro_auth.
GRANT EXECUTE ON FUNCTION "platform"."refuse_superadmin_membership"() TO "transferpro_auth";
--> statement-breakpoint
CREATE TRIGGER "member_not_superadmin"
  BEFORE INSERT ON "auth"."member"
  FOR EACH ROW EXECUTE FUNCTION "platform"."refuse_superadmin_membership"();
--> statement-breakpoint
CREATE FUNCTION "platform"."refuse_member_superadmin"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.member WHERE user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'a tenant member cannot be a superadmin' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "platform"."refuse_member_superadmin"() FROM PUBLIC;
--> statement-breakpoint
-- Only the migrator inserts a superadmin row. The owner can execute its own function.
CREATE TRIGGER "superadmin_not_member"
  BEFORE INSERT ON "platform"."superadmin"
  FOR EACH ROW EXECUTE FUNCTION "platform"."refuse_member_superadmin"();
