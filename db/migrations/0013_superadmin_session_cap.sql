-- A refresh writes expires_at as now plus seven days. The cap is created_at
-- plus eight hours, the same length as SUPERADMIN_SESSION_SECONDS.
-- The auth role updates the row, so it must be able to run this function.
-- search_path excludes the caller's schema: the table name is schema-qualified.
CREATE FUNCTION "platform"."cap_superadmin_session"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  capped timestamptz;
BEGIN
  IF EXISTS (SELECT 1 FROM platform.superadmin WHERE user_id = NEW.user_id) THEN
    capped := NEW.created_at + interval '8 hours';
    IF NEW.expires_at > capped THEN
      NEW.expires_at := capped;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "platform"."cap_superadmin_session"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "platform"."cap_superadmin_session"() TO "transferpro_auth";
--> statement-breakpoint
CREATE TRIGGER "superadmin_session_cap"
  BEFORE INSERT OR UPDATE ON "auth"."session"
  FOR EACH ROW EXECUTE FUNCTION "platform"."cap_superadmin_session"();
