CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trainings_title_trgm_idx" ON "trainings" USING gin ("title" gin_trgm_ops);
