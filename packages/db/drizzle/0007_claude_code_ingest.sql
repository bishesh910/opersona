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
