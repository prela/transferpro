-- A refresh writes expires_at as now plus seven days. A Tenant member no
-- longer keeps that session (ADR-0057). The cap is created_at plus twelve
-- hours, or sixteen when the active membership is a Driver so a holding
-- Ride can still be read. The use of the session refuses a Driver at
-- twelve hours when no Ride holds it. Superadmin rows are left to
-- platform.cap_superadmin_session. There is no last-Tenant column.
-- The auth role updates the row, so it must be able to run this function.
-- search_path excludes the caller's schema: table names are schema-qualified.
CREATE FUNCTION "platform"."cap_member_session"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  driver_membership boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM platform.superadmin WHERE user_id = NEW.user_id) THEN
    RETURN NEW;
  END IF;
  SELECT EXISTS (
    SELECT 1
    FROM auth.member
    WHERE user_id = NEW.user_id
      AND organization_id = NEW.active_organization_id
      AND role = 'driver'
  ) INTO driver_membership;
  IF driver_membership THEN
    NEW.expires_at := NEW.created_at + interval '16 hours';
  ELSE
    NEW.expires_at := NEW.created_at + interval '12 hours';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "platform"."cap_member_session"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "platform"."cap_member_session"() TO "transferpro_auth";
--> statement-breakpoint
CREATE TRIGGER "member_session_cap"
  BEFORE INSERT OR UPDATE ON "auth"."session"
  FOR EACH ROW EXECUTE FUNCTION "platform"."cap_member_session"();
