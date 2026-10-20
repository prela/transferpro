-- ExternalRef (ADR-0035). channel keeps the constant manual default.
-- external_id is filled by one table rewrite (the NOT NULL default), then
-- that default is dropped in this migration. There is no UPDATE statement.
-- An insert that omits external_id fails after this migration.
ALTER TABLE "app"."transfers" ADD COLUMN "channel" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."transfers" ADD COLUMN "external_id" text DEFAULT gen_random_uuid()::text NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."transfers" ALTER COLUMN "external_id" DROP DEFAULT;--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_tenant_channel_external_id" ON "app"."transfers" USING btree ("tenant_id","channel","external_id");--> statement-breakpoint
ALTER TABLE "app"."transfers" ADD CONSTRAINT "transfers_channel" CHECK ("app"."transfers"."channel" in ('manual'));
