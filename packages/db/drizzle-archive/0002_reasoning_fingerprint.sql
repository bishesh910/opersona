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
CREATE INDEX "reasoning_feedback_clone_idx" ON "reasoning_feedback" USING btree ("clone_id","created_at");--> statement-breakpoint
CREATE INDEX "reasoning_obs_clone_idx" ON "reasoning_observations" USING btree ("clone_id","pattern_key");