-- A Client has its own version, apart from any Transfer's (ADR-0046).
-- A constant default does not rewrite existing rows. The time and the member
-- stay null until an office data save. Dropping the columns reverses this.
ALTER TABLE "app"."clients" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."clients" ADD COLUMN "data_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."clients" ADD COLUMN "data_changed_by" text;--> statement-breakpoint
ALTER TABLE "app"."clients" ADD CONSTRAINT "clients_version" CHECK ("app"."clients"."version" >= 0);--> statement-breakpoint
ALTER TABLE "app"."clients" ADD CONSTRAINT "clients_data_change" CHECK (("app"."clients"."version" = 0 and "app"."clients"."data_changed_at" is null and "app"."clients"."data_changed_by" is null) or ("app"."clients"."version" >= 1 and "app"."clients"."data_changed_at" is not null and "app"."clients"."data_changed_by" <> ''));