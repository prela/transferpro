-- The state before a storno ask: created or sent, and only while cancelling.
-- No default and no UPDATE, so existing rows are not rewritten.
ALTER TABLE "app"."invoices" ADD COLUMN "storno_from" text;--> statement-breakpoint
ALTER TABLE "app"."invoices" ADD CONSTRAINT "invoices_storno_from" CHECK ("app"."invoices"."storno_from" is null or ("app"."invoices"."state" = 'cancelling' and "app"."invoices"."storno_from" in ('created', 'sent')));