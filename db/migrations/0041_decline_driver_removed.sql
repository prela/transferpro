-- A declining Driver can leave the catalog. The alert row stays.
-- SET NULL (driver_id) keeps tenant_id. A composite SET NULL would clear it
-- and fail, because tenant_id is not null. The app role still has no DELETE
-- on drivers or on ride_alert. Reversing this restores NOT NULL and NO ACTION.
ALTER TABLE "app"."ride_alert" DROP CONSTRAINT "ride_alert_driver_fk";--> statement-breakpoint
ALTER TABLE "app"."ride_alert" ALTER COLUMN "driver_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."ride_alert" ADD CONSTRAINT "ride_alert_driver_fk" FOREIGN KEY ("tenant_id","driver_id") REFERENCES "app"."drivers"("tenant_id","id") ON DELETE SET NULL ("driver_id") ON UPDATE no action;
