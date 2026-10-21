CREATE TYPE "public"."profile_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."skill_level" AS ENUM('beginner', 'intermediate', 'advanced', 'elite');--> statement-breakpoint
CREATE TYPE "public"."draft_status" AS ENUM('setup', 'active', 'paused', 'completed');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"photo_url" text,
	"date_of_birth" date,
	"height_cm" integer,
	"positions" text[] NOT NULL,
	"skill_level" "skill_level",
	"experience" text,
	"bio" text,
	"profile_status" "profile_status" DEFAULT 'pending' NOT NULL,
	"status_reason" text,
	"is_draft_eligible" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "player_profiles_positions_valid" CHECK ("player_profiles"."positions" <@ ARRAY['PG','SG','SF','PF','C']::text[]),
	CONSTRAINT "player_profiles_height_range" CHECK ("player_profiles"."height_cm" IS NULL OR ("player_profiles"."height_cm" BETWEEN 100 AND 260))
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "draft_picks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"pick_number" integer NOT NULL,
	"team_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"picked_by_user_id" uuid NOT NULL,
	"picked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by_user_id" uuid,
	"undo_reason" text,
	"idempotency_key" text,
	CONSTRAINT "draft_picks_pick_positive" CHECK ("draft_picks"."pick_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "draft_team_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"captain_user_id" uuid NOT NULL,
	"draft_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_assignments_order_range" CHECK ("draft_team_assignments"."draft_order" BETWEEN 1 AND 4)
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "draft_status" DEFAULT 'setup' NOT NULL,
	"current_pick_number" integer DEFAULT 1 NOT NULL,
	"total_rounds" integer DEFAULT 8 NOT NULL,
	"started_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drafts_current_pick_positive" CHECK ("drafts"."current_pick_number" >= 1),
	CONSTRAINT "drafts_rounds_positive" CHECK ("drafts"."total_rounds" >= 1)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_player_id_player_profiles_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_picked_by_user_id_users_id_fk" FOREIGN KEY ("picked_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_undone_by_user_id_users_id_fk" FOREIGN KEY ("undone_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_team_assignments" ADD CONSTRAINT "draft_team_assignments_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_team_assignments" ADD CONSTRAINT "draft_team_assignments_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_team_assignments" ADD CONSTRAINT "draft_team_assignments_captain_user_id_users_id_fk" FOREIGN KEY ("captain_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "draft_picks_draft_pick_uq" ON "draft_picks" USING btree ("draft_id","pick_number");--> statement-breakpoint
CREATE UNIQUE INDEX "draft_picks_active_player_uq" ON "draft_picks" USING btree ("draft_id","player_id") WHERE "draft_picks"."undone_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "draft_picks_idempotency_uq" ON "draft_picks" USING btree ("draft_id","idempotency_key") WHERE "draft_picks"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "draft_picks_draft_idx" ON "draft_picks" USING btree ("draft_id");--> statement-breakpoint
CREATE UNIQUE INDEX "draft_assignments_draft_team_uq" ON "draft_team_assignments" USING btree ("draft_id","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "draft_assignments_draft_captain_uq" ON "draft_team_assignments" USING btree ("draft_id","captain_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "draft_assignments_draft_order_uq" ON "draft_team_assignments" USING btree ("draft_id","draft_order");--> statement-breakpoint
CREATE INDEX "draft_assignments_draft_idx" ON "draft_team_assignments" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");