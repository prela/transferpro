-- One version covers a Transfer and its Ride (ADR-0046).
-- A constant default does not rewrite existing rows. The time and the member
-- stay null until an office data save. Dropping the columns reverses this.
ALTER TABLE "app"."transfers" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."transfers" ADD COLUMN "data_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."transfers" ADD COLUMN "data_changed_by" text;--> statement-breakpoint
ALTER TABLE "app"."transfers" ADD CONSTRAINT "transfers_version" CHECK ("app"."transfers"."version" >= 0);--> statement-breakpoint
ALTER TABLE "app"."transfers" ADD CONSTRAINT "transfers_data_change" CHECK (("app"."transfers"."version" = 0 and "app"."transfers"."data_changed_at" is null and "app"."transfers"."data_changed_by" is null) or ("app"."transfers"."version" >= 1 and "app"."transfers"."data_changed_at" is not null and "app"."transfers"."data_changed_by" <> ''));
