CREATE TABLE "app"."mail_outbox" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"ride_id" uuid,
	"driver_id" uuid,
	"vehicle_id" uuid,
	"work_order_status" text,
	"invitation_id" uuid,
	"state" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_outbox_kind" CHECK ("app"."mail_outbox"."kind" in ('work_order', 'invitation')),
	CONSTRAINT "mail_outbox_state" CHECK ("app"."mail_outbox"."state" in ('pending', 'sent', 'failed', 'stale')),
	CONSTRAINT "mail_outbox_attempt_count" CHECK ("app"."mail_outbox"."attempt_count" between 0 and 4),
	CONSTRAINT "mail_outbox_shape" CHECK ((
      "app"."mail_outbox"."kind" = 'work_order'
        and "app"."mail_outbox"."ride_id" is not null
        and "app"."mail_outbox"."driver_id" is not null
        and "app"."mail_outbox"."work_order_status" in ('assigned', 'changed', 'cancelled', 'no_longer_yours')
        and "app"."mail_outbox"."invitation_id" is null
    ) or (
      "app"."mail_outbox"."kind" = 'invitation'
        and "app"."mail_outbox"."invitation_id" is not null
        and "app"."mail_outbox"."ride_id" is null
        and "app"."mail_outbox"."driver_id" is null
        and "app"."mail_outbox"."vehicle_id" is null
        and "app"."mail_outbox"."work_order_status" is null
    ))
);
--> statement-breakpoint
ALTER TABLE "app"."mail_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."mail_outbox" ADD CONSTRAINT "mail_outbox_ride_fk" FOREIGN KEY ("tenant_id","ride_id") REFERENCES "app"."rides"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."mail_outbox" ADD CONSTRAINT "mail_outbox_driver_fk" FOREIGN KEY ("tenant_id","driver_id") REFERENCES "app"."drivers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."mail_outbox" ADD CONSTRAINT "mail_outbox_vehicle_fk" FOREIGN KEY ("tenant_id","vehicle_id") REFERENCES "app"."vehicles"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "app"."mail_outbox" AS PERMISSIVE FOR ALL TO "transferpro_app" USING ("app"."mail_outbox"."tenant_id" = app.current_tenant_id()) WITH CHECK ("app"."mail_outbox"."tenant_id" = app.current_tenant_id());
--> statement-breakpoint
-- drizzle-kit cannot emit FORCE RLS or this grant. There is no DELETE.
-- ADR-0045 allows a later retention job to delete old rows. That grant is not here.
ALTER TABLE "app"."mail_outbox" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "app"."mail_outbox" FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "app"."mail_outbox" TO "transferpro_app";