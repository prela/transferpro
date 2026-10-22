-- Last check of a Location's place reference (ADR-0052).
-- Nullable, and null whenever place_ref is null. No default and no UPDATE,
-- so existing rows are not rewritten. No new grant and no DELETE grant.
ALTER TABLE "app"."locations" ADD COLUMN "place_ref_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."locations" ADD CONSTRAINT "locations_place_ref_checked_at" CHECK ("app"."locations"."place_ref_checked_at" is null or "app"."locations"."place_ref" is not null);