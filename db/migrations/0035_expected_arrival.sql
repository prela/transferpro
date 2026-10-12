-- The live estimate, and the instant the next movement is measured against.
-- The basis is the last estimate the Driver was told, or the first stored
-- estimate when the Driver has been told nothing.
ALTER TABLE "app"."transfers" ADD COLUMN "expected_arrival_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."transfers" ADD COLUMN "expected_arrival_basis_at" timestamp with time zone;