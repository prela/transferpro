-- `data_changed_by <> ''` is unknown when the member is null, so the checks
-- from 0043 and 0047 let version >= 1 through with no member. This does not
-- rewrite rows. A row the new check would refuse stops the migration.
-- The owner bypasses row security, so the scan sees every Tenant.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM app.transfers
    WHERE NOT (
      (version = 0 AND data_changed_at IS NULL AND data_changed_by IS NULL)
      OR (version >= 1 AND data_changed_at IS NOT NULL AND data_changed_by IS NOT NULL AND data_changed_by <> '')
    )
  ) THEN
    RAISE EXCEPTION 'app.transfers has a row the data-change check would refuse';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM app.clients
    WHERE NOT (
      (version = 0 AND data_changed_at IS NULL AND data_changed_by IS NULL)
      OR (version >= 1 AND data_changed_at IS NOT NULL AND data_changed_by IS NOT NULL AND data_changed_by <> '')
    )
  ) THEN
    RAISE EXCEPTION 'app.clients has a row the data-change check would refuse';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "app"."clients" DROP CONSTRAINT "clients_data_change";--> statement-breakpoint
ALTER TABLE "app"."transfers" DROP CONSTRAINT "transfers_data_change";--> statement-breakpoint
ALTER TABLE "app"."clients" ADD CONSTRAINT "clients_data_change" CHECK (("app"."clients"."version" = 0 and "app"."clients"."data_changed_at" is null and "app"."clients"."data_changed_by" is null) or ("app"."clients"."version" >= 1 and "app"."clients"."data_changed_at" is not null and "app"."clients"."data_changed_by" is not null and "app"."clients"."data_changed_by" <> ''));--> statement-breakpoint
ALTER TABLE "app"."transfers" ADD CONSTRAINT "transfers_data_change" CHECK (("app"."transfers"."version" = 0 and "app"."transfers"."data_changed_at" is null and "app"."transfers"."data_changed_by" is null) or ("app"."transfers"."version" >= 1 and "app"."transfers"."data_changed_at" is not null and "app"."transfers"."data_changed_by" is not null and "app"."transfers"."data_changed_by" <> ''));
