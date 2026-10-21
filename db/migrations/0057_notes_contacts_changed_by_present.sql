-- `data_changed_by <> ''` is unknown when the member is null, so the checks
-- from 0050 and 0054 let version >= 1 through with no member. This does not
-- rewrite rows. A row the new check would refuse stops the migration.
-- The owner bypasses row security, so the scan sees every Tenant.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM app.client_notes
    WHERE NOT (
      (version = 0 AND data_changed_at IS NULL AND data_changed_by IS NULL)
      OR (version >= 1 AND data_changed_at IS NOT NULL AND data_changed_by IS NOT NULL AND data_changed_by <> '')
    )
  ) THEN
    RAISE EXCEPTION 'app.client_notes has a row the data-change check would refuse';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM app.client_contact_persons
    WHERE NOT (
      (version = 0 AND data_changed_at IS NULL AND data_changed_by IS NULL)
      OR (version >= 1 AND data_changed_at IS NOT NULL AND data_changed_by IS NOT NULL AND data_changed_by <> '')
    )
  ) THEN
    RAISE EXCEPTION 'app.client_contact_persons has a row the data-change check would refuse';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "app"."client_notes" DROP CONSTRAINT "client_notes_data_change";--> statement-breakpoint
ALTER TABLE "app"."client_contact_persons" DROP CONSTRAINT "client_contact_persons_data_change";--> statement-breakpoint
ALTER TABLE "app"."client_notes" ADD CONSTRAINT "client_notes_data_change" CHECK (("app"."client_notes"."version" = 0 and "app"."client_notes"."data_changed_at" is null and "app"."client_notes"."data_changed_by" is null) or ("app"."client_notes"."version" >= 1 and "app"."client_notes"."data_changed_at" is not null and "app"."client_notes"."data_changed_by" is not null and "app"."client_notes"."data_changed_by" <> ''));--> statement-breakpoint
ALTER TABLE "app"."client_contact_persons" ADD CONSTRAINT "client_contact_persons_data_change" CHECK (("app"."client_contact_persons"."version" = 0 and "app"."client_contact_persons"."data_changed_at" is null and "app"."client_contact_persons"."data_changed_by" is null) or ("app"."client_contact_persons"."version" >= 1 and "app"."client_contact_persons"."data_changed_at" is not null and "app"."client_contact_persons"."data_changed_by" is not null and "app"."client_contact_persons"."data_changed_by" <> ''));
