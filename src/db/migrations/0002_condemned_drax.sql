ALTER TABLE "schedules" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "also_messenger" boolean DEFAULT false NOT NULL;