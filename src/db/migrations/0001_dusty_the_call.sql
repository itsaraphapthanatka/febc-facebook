ALTER TABLE "broadcasts" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "page_ids" uuid[];--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "only_within_24h" boolean;