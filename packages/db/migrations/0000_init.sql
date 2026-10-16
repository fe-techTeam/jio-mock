CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE TABLE "authors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"platform_user_id" text NOT NULL,
	"handle" text,
	"display_name" text,
	"followers" integer,
	"kind" text DEFAULT 'other' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delete_after" timestamp with time zone NOT NULL,
	CONSTRAINT "authors_platform_user_uq" UNIQUE("platform","platform_user_id")
);
--> statement-breakpoint
CREATE TABLE "classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"topic_id" uuid NOT NULL,
	"sentiment" text NOT NULL,
	"entities" text[] DEFAULT '{}' NOT NULL,
	"confidence" text NOT NULL,
	"gloss_en" text,
	"model" text,
	"prompt_version" text,
	"actor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "config_versions" (
	"version" integer PRIMARY KEY NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"config" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"source_key" text,
	"status" text,
	"items_new" integer,
	"cost_usd" double precision,
	"duration_ms" integer,
	"error" text,
	"ip" text,
	"actor" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series" text NOT NULL,
	"value" double precision NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"source_key" text NOT NULL,
	"source_url" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_points_series_source_observed_uq" UNIQUE("series","source_key","observed_at")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_key" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"author_id" uuid,
	"lane" text NOT NULL,
	"text" text NOT NULL,
	"lang" text,
	"published_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reach_raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reach_score" real,
	"content_hash" text,
	"embedding" vector(1024),
	"near_dup_cluster_id" text,
	"matched_terms" text[] DEFAULT '{}' NOT NULL,
	"raw_json" jsonb,
	"is_fixture" boolean DEFAULT false NOT NULL,
	CONSTRAINT "posts_source_external_uq" UNIQUE("source_key","external_id")
);
--> statement-breakpoint
CREATE TABLE "topic_stats_15m" (
	"bucket_start" timestamp with time zone NOT NULL,
	"topic_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"lane" text NOT NULL,
	"items" integer DEFAULT 0 NOT NULL,
	"pos" integer DEFAULT 0 NOT NULL,
	"neu" integer DEFAULT 0 NOT NULL,
	"neg" integer DEFAULT 0 NOT NULL,
	"low_conf" integer DEFAULT 0 NOT NULL,
	"reach_pos" real DEFAULT 0 NOT NULL,
	"reach_neu" real DEFAULT 0 NOT NULL,
	"reach_neg" real DEFAULT 0 NOT NULL,
	"suspected_coordinated" integer DEFAULT 0 NOT NULL,
	"burst_flag" boolean DEFAULT false NOT NULL,
	"top5_author_share" real,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_stats_15m_pk" PRIMARY KEY("bucket_start","topic_id","entity","lane")
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"example_phrases" text[] DEFAULT '{}' NOT NULL,
	"summary_2line" text,
	"summary_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"promoted_at" timestamp with time zone,
	"merged_into_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topics_slug_uq" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "classifications" ADD CONSTRAINT "classifications_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classifications" ADD CONSTRAINT "classifications_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_stats_15m" ADD CONSTRAINT "topic_stats_15m_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_merged_into_id_topics_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "classifications_post_created_idx" ON "classifications" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE INDEX "classifications_origin_created_idx" ON "classifications" USING btree ("origin","created_at");--> statement-breakpoint
CREATE INDEX "classifications_topic_idx" ON "classifications" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "event_log_kind_at_idx" ON "event_log" USING btree ("kind","at");--> statement-breakpoint
CREATE INDEX "event_log_source_kind_at_idx" ON "event_log" USING btree ("source_key","kind","at");--> statement-breakpoint
CREATE INDEX "event_log_actor_kind_at_idx" ON "event_log" USING btree ("actor","kind","at");--> statement-breakpoint
CREATE INDEX "market_points_series_observed_idx" ON "market_points" USING btree ("series","observed_at");--> statement-breakpoint
CREATE INDEX "posts_published_at_idx" ON "posts" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "posts_lane_published_at_idx" ON "posts" USING btree ("lane","published_at");--> statement-breakpoint
CREATE INDEX "posts_content_hash_idx" ON "posts" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "posts_author_id_idx" ON "posts" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "posts_near_dup_cluster_idx" ON "posts" USING btree ("near_dup_cluster_id");--> statement-breakpoint
CREATE INDEX "posts_untriaged_idx" ON "posts" USING btree ("fetched_at") WHERE lang is null;--> statement-breakpoint
CREATE INDEX "posts_embedding_hnsw_idx" ON "posts" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "topic_stats_15m_topic_bucket_idx" ON "topic_stats_15m" USING btree ("topic_id","bucket_start");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");