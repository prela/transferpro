-- pg-boss storage. The migrator is a member of transferpro_queue, so it can
-- create the schema owned by that role and record default privileges for
-- objects that role creates later. The queue role has no CREATE on the database.
-- The app role gets DML so send can join a tenant transaction. It does not get DDL.
-- The queue role is not granted schema app or auth.
CREATE SCHEMA IF NOT EXISTS "pgboss" AUTHORIZATION "transferpro_queue";
--> statement-breakpoint
REVOKE ALL ON SCHEMA "pgboss" FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "pgboss" TO "transferpro_app";
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE "transferpro_queue" IN SCHEMA "pgboss" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "transferpro_app";
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE "transferpro_queue" IN SCHEMA "pgboss" GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "transferpro_app";
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE "transferpro_queue" IN SCHEMA "pgboss" GRANT EXECUTE ON FUNCTIONS TO "transferpro_app";
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE "transferpro_queue" IN SCHEMA "pgboss" GRANT USAGE ON TYPES TO "transferpro_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "pgboss" TO "transferpro_app";
--> statement-breakpoint
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA "pgboss" TO "transferpro_app";
--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA "pgboss" TO "transferpro_app";
