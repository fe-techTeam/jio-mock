ALTER TABLE "posts" ADD COLUMN "coord_suspected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "coord_detected_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "posts_coord_suspected_idx" ON "posts" USING btree ("published_at") WHERE coord_suspected;