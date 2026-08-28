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
CREATE TABLE "auth_failures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
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
CREATE TABLE "bridge_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text DEFAULT 'my machine' NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp,
	"revoked_at" timestamp,
	CONSTRAINT "bridge_tokens_token_hash_key" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "claude_code_sessions" (
	"clone_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"org_id" text NOT NULL,
	"source" text NOT NULL,
	"project" text,
	"bytes" integer DEFAULT 0 NOT NULL,
	"human_turns" integer DEFAULT 0 NOT NULL,
	"observations" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"note" text,
	"extracted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claude_code_sessions_clone_id_session_id_pk" PRIMARY KEY("clone_id","session_id")
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
	"kind" text DEFAULT 'member' NOT NULL,
	"archived_at" timestamp with time zone,
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
	"pinned" boolean DEFAULT false NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text DEFAULT 'New conversation' NOT NULL,
	"sdk_session_id" text,
	"mode" text DEFAULT 'claude' NOT NULL,
	"model" text,
	"effort" text,
	"status" text DEFAULT 'idle' NOT NULL,
	"cwd" text,
	"workspace" text,
	"resume_cwd" text,
	"extracted_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_slug_unique" UNIQUE("slug")
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
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"filename" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"observations" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imported_personas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid NOT NULL,
	"imported_by" text NOT NULL,
	"source_published_id" uuid,
	"source_slug" text,
	"source_version" integer NOT NULL,
	"artifact" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "imported_personas_clone_uq" UNIQUE("clone_id")
);
--> statement-breakpoint
CREATE TABLE "ingest_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"name" text DEFAULT 'Claude Code' NOT NULL,
	"token_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingest_tokens_token_hash_unique" UNIQUE("token_hash")
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
	"boss_clone_id" uuid,
	"seal_key_fp" text,
	"sealed_at" timestamp,
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
CREATE TABLE "persona_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"published_id" uuid NOT NULL,
	"grantee_email" text NOT NULL,
	"grantee_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persona_grants_uq" UNIQUE("published_id","grantee_email")
);
--> statement-breakpoint
CREATE TABLE "persona_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"published_id" uuid NOT NULL,
	"reporter_user_id" text,
	"reason" text NOT NULL,
	"details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text
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
CREATE TABLE "personality_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid NOT NULL,
	"answers" jsonb NOT NULL,
	"scores" jsonb NOT NULL,
	"type" text NOT NULL,
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
CREATE TABLE "published_personas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"slug" text NOT NULL,
	"artifact" jsonb NOT NULL,
	"sections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"visibility" text DEFAULT 'restricted' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"import_count" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unpublished_at" timestamp with time zone,
	CONSTRAINT "published_personas_clone_uq" UNIQUE("clone_id"),
	CONSTRAINT "published_personas_slug_uq" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "reasoning_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"verdict" text NOT NULL,
	"comment" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reasoning_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid NOT NULL,
	"pattern_key" text NOT NULL,
	"dimension" text NOT NULL,
	"description" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"source_kind" text NOT NULL,
	"source_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reasoning_patterns" (
	"clone_id" uuid NOT NULL,
	"pattern_key" text NOT NULL,
	"org_id" text NOT NULL,
	"dimension" text NOT NULL,
	"description" text NOT NULL,
	"strength" real DEFAULT 0 NOT NULL,
	"n_sources" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'emerging' NOT NULL,
	"user_verdict" text,
	"examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reasoning_patterns_clone_id_pattern_key_pk" PRIMARY KEY("clone_id","pattern_key")
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
CREATE TABLE "self_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"domain" text DEFAULT '' NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"model" text,
	"verdict" text,
	"comment" text,
	"rated_at" timestamp with time zone,
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
	"files" jsonb,
	"edited_content" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text DEFAULT 'local:credential' NOT NULL,
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
CREATE TABLE "jwks" (
	"id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"expires_at" timestamp,
	"alg" text,
	"crv" text
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
CREATE TABLE "oauthAccessToken" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"refresh_id" text,
	"expires_at" timestamp,
	"created_at" timestamp,
	"revoked" timestamp,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL,
	CONSTRAINT "oauthAccessToken_token_key" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "oauthClient" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text,
	"client_discovery_id" text,
	"disabled" boolean,
	"skip_consent" boolean,
	"enable_end_session" boolean,
	"subject_type" text,
	"scopes" text[],
	"client_credentials_scopes" text[],
	"user_id" text,
	"created_at" timestamp,
	"updated_at" timestamp,
	"name" text,
	"uri" text,
	"icon" text,
	"contacts" text[],
	"tos" text,
	"policy" text,
	"software_id" text,
	"software_version" text,
	"software_statement" text,
	"redirect_uris" text[] NOT NULL,
	"post_logout_redirect_uris" text[],
	"backchannel_logout_uri" text,
	"backchannel_logout_session_required" boolean,
	"token_endpoint_auth_method" text,
	"application_type" text,
	"jwks" text,
	"jwks_uri" text,
	"grant_types" text[],
	"response_types" text[],
	"require_pkce" boolean,
	"dpop_bound_access_tokens" boolean,
	"reference_id" text,
	"metadata" jsonb,
	CONSTRAINT "oauthClient_client_id_key" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "oauthClientAssertion" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauthClientResource" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "oauthConsent" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text,
	"reference_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"scopes" text[] NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "oauthRefreshToken" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text NOT NULL,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"expires_at" timestamp,
	"created_at" timestamp,
	"revoked" timestamp,
	"rotated_at" timestamp,
	"rotation_replay_response" text,
	"rotation_replay_expires_at" timestamp,
	"auth_time" timestamp,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL,
	CONSTRAINT "oauthRefreshToken_token_key" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "oauthResource" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"access_token_ttl" integer,
	"refresh_token_ttl" integer,
	"signing_algorithm" text,
	"signing_key_id" text,
	"allowed_scopes" text[],
	"custom_claims" jsonb,
	"dpop_bound_access_tokens_required" boolean,
	"disabled" boolean,
	"created_at" timestamp,
	"updated_at" timestamp,
	"policy_version" integer,
	"metadata" jsonb,
	CONSTRAINT "oauthResource_identifier_key" UNIQUE("identifier")
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
CREATE TABLE "rateLimit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text,
	"count" integer,
	"last_request" bigint
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
CREATE TABLE "twoFactor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean,
	"failed_verification_count" integer,
	"locked_until" timestamp
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
	"two_factor_enabled" boolean,
	"approved_at" timestamp with time zone,
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
ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_client_id_oauthClient_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauthClient"("client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_refresh_id_oauthRefreshToken_id_fk" FOREIGN KEY ("refresh_id") REFERENCES "public"."oauthRefreshToken"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthClient" ADD CONSTRAINT "oauthClient_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthClientResource" ADD CONSTRAINT "oauthClientResource_client_id_oauthClient_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauthClient"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthClientResource" ADD CONSTRAINT "oauthClientResource_resource_id_oauthResource_identifier_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."oauthResource"("identifier") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthConsent" ADD CONSTRAINT "oauthConsent_client_id_oauthClient_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauthClient"("client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthConsent" ADD CONSTRAINT "oauthConsent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_client_id_oauthClient_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauthClient"("client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_clone_idx" ON "approvals" USING btree ("clone_id","status");--> statement-breakpoint
CREATE INDEX "auth_failures_email_idx" ON "auth_failures" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "bridge_tokens_org_idx" ON "bridge_tokens" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clones_org_owner_uq" ON "clones" USING btree ("org_id","owner_user_id") WHERE kind = 'member';--> statement-breakpoint
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
CREATE INDEX "imported_personas_org_idx" ON "imported_personas" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "learning_events_clone_idx" ON "learning_events" USING btree ("clone_id","review_status","created_at");--> statement-breakpoint
CREATE INDEX "persona_grants_pub_idx" ON "persona_grants" USING btree ("published_id");--> statement-breakpoint
CREATE INDEX "persona_reports_open_idx" ON "persona_reports" USING btree ("resolved_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshots_clone_version_uq" ON "persona_snapshots" USING btree ("clone_id","version");--> statement-breakpoint
CREATE INDEX "personality_clone_idx" ON "personality_tests" USING btree ("clone_id","created_at");--> statement-breakpoint
CREATE INDEX "playbooks_clone_idx" ON "playbooks" USING btree ("clone_id","status");--> statement-breakpoint
CREATE INDEX "playbooks_tsv_idx" ON "playbooks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "published_personas_browse_idx" ON "published_personas" USING btree ("visibility","status","import_count");--> statement-breakpoint
CREATE INDEX "reasoning_feedback_clone_idx" ON "reasoning_feedback" USING btree ("clone_id","created_at");--> statement-breakpoint
CREATE INDEX "reasoning_obs_clone_idx" ON "reasoning_observations" USING btree ("clone_id","pattern_key");--> statement-breakpoint
CREATE INDEX "self_tests_clone_idx" ON "self_tests" USING btree ("clone_id","created_at");--> statement-breakpoint
CREATE INDEX "session_costs_org_idx" ON "session_costs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "style_obs_clone_idx" ON "style_observations" USING btree ("clone_id","dimension");--> statement-breakpoint
CREATE INDEX "turns_conv_idx" ON "turns" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON "account" USING btree ("issuer","account_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_user_idx" ON "oauthAccessToken" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauthConsent_user_idx" ON "oauthConsent" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauthRefreshToken_user_idx" ON "oauthRefreshToken" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");