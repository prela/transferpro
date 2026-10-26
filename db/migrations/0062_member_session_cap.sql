-- A refresh writes expires_at as now plus seven days. A Tenant member no
-- longer keeps that session (ADR-0057). The cap is created_at plus twelve
-- hours, or sixteen when the active membership is a Driver so a holding
-- Ride can still be read. One membership and no company yet uses that
-- role, so a sole Driver's row is sixteen hours before the company is
-- stored. The use of the session refuses a Driver at
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
  -- The active company decides. One membership and no company yet uses
  -- that role, so a sole Driver's row survives until the hold can be seen.
  -- Two companies and none active stay at twelve hours.
  SELECT EXISTS (
    SELECT 1
    FROM auth.member
    WHERE user_id = NEW.user_id
      AND role = 'driver'
      AND (
        organization_id = NEW.active_organization_id
        OR (
          NEW.active_organization_id IS NULL
          AND (
            SELECT count(*)
            FROM auth.member AS memberships
            WHERE memberships.user_id = NEW.user_id
          ) = 1
        )
      )
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
