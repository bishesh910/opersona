CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid NOT NULL,
	"conversation_id" uuid,
	"kind" text DEFAULT 'tool' NOT NULL,
	"tool" text,
	"input" jsonb,
	"question" text,
	"options" text[],
	"status" text DEFAULT 'pending' NOT NULL,
	"answer" text,
	"updated_input" jsonb,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "autonomy_ledger" (
	"clone_id" uuid NOT NULL,
	"org_id" text NOT NULL,
	"task_type" text NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"approved_clean" integer DEFAULT 0 NOT NULL,
	"approved_edited" integer DEFAULT 0 NOT NULL,
	"rejected" integer DEFAULT 0 NOT NULL,
	"streak_clean" integer DEFAULT 0 NOT NULL,
	"admin_cap" integer,
	"last_change_at" timestamp with time zone,
	"last_change_reason" text,
	CONSTRAINT "autonomy_ledger_clone_id_task_type_pk" PRIMARY KEY("clone_id","task_type")
);
--> statement-breakpoint
CREATE TABLE "clone_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"conversation" text NOT NULL,
	"in_reply_to" text,
	"from_clone" uuid NOT NULL,
	"to_clone" text NOT NULL,
	"act" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"hops" integer DEFAULT 0 NOT NULL,
	"requires_reply" boolean DEFAULT false NOT NULL,
	"needs_human" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"avatar_recipe" jsonb,
	"active_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "condensed_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid NOT NULL,
	"domain" text DEFAULT 'general' NOT NULL,
	"summary_md" text DEFAULT '' NOT NULL,
	"covers_episode_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT 'New conversation' NOT NULL,
	"sdk_session_id" text,
	"status" text DEFAULT 'idle' NOT NULL,
	"extracted_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"source_kind" text NOT NULL,
	"source_ref" text,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_reinforced_at" timestamp with time zone,
	"reinforce_count" integer DEFAULT 0 NOT NULL,
	"supersedes" uuid,
	"conversation_id" uuid,
	"task_id" uuid,
	"turn_id" uuid,
	"clone_output" text DEFAULT '' NOT NULL,
	"human_fix" text DEFAULT '' NOT NULL,
	"diff" text,
	"kind" text DEFAULT 'one_off' NOT NULL,
	"severity" text DEFAULT 'low' NOT NULL,
	"lesson" text DEFAULT '' NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"applied" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"standing" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid,
	"ord" integer NOT NULL,
	"content" text NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(content,''))) STORED
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"trust" text DEFAULT 'untrusted' NOT NULL,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"source_kind" text NOT NULL,
	"source_ref" text,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_reinforced_at" timestamp with time zone,
	"reinforce_count" integer DEFAULT 0 NOT NULL,
	"supersedes" uuid,
	"conversation_id" uuid,
	"domain" text,
	"title" text NOT NULL,
	"problem" text DEFAULT '' NOT NULL,
	"approach_summary" text DEFAULT '' NOT NULL,
	"key_decisions" text[] DEFAULT '{}'::text[] NOT NULL,
	"outcome" text DEFAULT 'unknown' NOT NULL,
	"duration_s" integer,
	"turn_count" integer,
	"playbook_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"fact_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"condensed" boolean DEFAULT false NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(problem,'') || ' ' || coalesce(approach_summary,''))) STORED
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"source_kind" text NOT NULL,
	"source_ref" text,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_reinforced_at" timestamp with time zone,
	"reinforce_count" integer DEFAULT 0 NOT NULL,
	"supersedes" uuid,
	"statement" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"domain" text,
	"pinned" boolean DEFAULT false NOT NULL,
	"shareable" boolean DEFAULT false NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(statement,'') || ' ' || coalesce(domain,''))) STORED
);
--> statement-breakpoint
CREATE TABLE "learning_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid NOT NULL,
	"layer" text NOT NULL,
	"target_id" text,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"confidence" real,
	"source_kind" text,
	"source_ref" text,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_settings" (
	"org_id" text PRIMARY KEY NOT NULL,
	"anthropic_key_enc" text,
	"chat_model" text DEFAULT 'claude-opus-5' NOT NULL,
	"extract_model" text DEFAULT 'claude-sonnet-5' NOT NULL,
	"condense_model" text DEFAULT 'claude-haiku-4-5' NOT NULL,
	"chat_effort" text DEFAULT 'high' NOT NULL,
	"monthly_budget_usd" real,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_briefs" (
	"clone_id" uuid PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"role_title" text DEFAULT '' NOT NULL,
	"team" text DEFAULT '' NOT NULL,
	"brief_md" text DEFAULT '' NOT NULL,
	"operating_rules" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"rendered_prompt" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"token_estimate" integer,
	"layer_versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reflection_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playbook_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"playbook_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"diff" text,
	"reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"source_kind" text NOT NULL,
	"source_ref" text,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_reinforced_at" timestamp with time zone,
	"reinforce_count" integer DEFAULT 0 NOT NULL,
	"supersedes" uuid,
	"name" text NOT NULL,
	"domain" text,
	"version" integer DEFAULT 1 NOT NULL,
	"trigger" text NOT NULL,
	"preconditions" text[] DEFAULT '{}'::text[] NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pitfalls" text[] DEFAULT '{}'::text[] NOT NULL,
	"outcome_stats" jsonb DEFAULT '{"used":0,"succeeded":0,"failed":0}'::jsonb NOT NULL,
	"source_episode_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"shareable" boolean DEFAULT true NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(name,'') || ' ' || coalesce(trigger,'') || ' ' || coalesce(domain,''))) STORED
);
--> statement-breakpoint
CREATE TABLE "reflection_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"reason" text,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"backup_ref" text
);
--> statement-breakpoint
CREATE TABLE "rejected_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clone_id" uuid NOT NULL,
	"layer" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid NOT NULL,
	"conversation_id" uuid,
	"kind" text DEFAULT 'chat' NOT NULL,
	"model" text,
	"prompt_hash" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_creation_input_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "style_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"source_kind" text NOT NULL,
	"source_ref" text,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_reinforced_at" timestamp with time zone,
	"reinforce_count" integer DEFAULT 0 NOT NULL,
	"supersedes" uuid,
	"dimension" text NOT NULL,
	"observed_value" text NOT NULL,
	"weight" real DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "style_profiles" (
	"clone_id" uuid PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"dimensions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rendered_md" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"task_type" text NOT NULL,
	"verdict" text NOT NULL,
	"edit_distance" integer,
	"comment" text,
	"reviewer_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid NOT NULL,
	"task_type" text NOT NULL,
	"spec" text NOT NULL,
	"input" jsonb,
	"status" text DEFAULT 'queued' NOT NULL,
	"output" text,
	"autonomy_level_at_run" integer,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"org_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"tool_uses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edited_content" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_clone_idx" ON "approvals" USING btree ("clone_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "clones_org_owner_uq" ON "clones" USING btree ("org_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "clones_org_idx" ON "clones" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "condensed_clone_domain_uq" ON "condensed_history" USING btree ("clone_id","domain");--> statement-breakpoint
CREATE INDEX "conversations_clone_idx" ON "conversations" USING btree ("clone_id","last_activity_at");--> statement-breakpoint
CREATE INDEX "corrections_clone_idx" ON "corrections" USING btree ("clone_id","standing");--> statement-breakpoint
CREATE INDEX "chunks_doc_idx" ON "document_chunks" USING btree ("document_id","ord");--> statement-breakpoint
CREATE INDEX "chunks_tsv_idx" ON "document_chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "documents_org_idx" ON "documents" USING btree ("org_id","clone_id");--> statement-breakpoint
CREATE INDEX "episodes_clone_idx" ON "episodes" USING btree ("clone_id","created_at");--> statement-breakpoint
CREATE INDEX "episodes_tsv_idx" ON "episodes" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "facts_clone_idx" ON "facts" USING btree ("clone_id","status");--> statement-breakpoint
CREATE INDEX "facts_tsv_idx" ON "facts" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "learning_events_clone_idx" ON "learning_events" USING btree ("clone_id","review_status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshots_clone_version_uq" ON "persona_snapshots" USING btree ("clone_id","version");--> statement-breakpoint
CREATE INDEX "playbooks_clone_idx" ON "playbooks" USING btree ("clone_id","status");--> statement-breakpoint
CREATE INDEX "playbooks_tsv_idx" ON "playbooks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "session_costs_org_idx" ON "session_costs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "style_obs_clone_idx" ON "style_observations" USING btree ("clone_id","dimension");--> statement-breakpoint
CREATE INDEX "turns_conv_idx" ON "turns" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");