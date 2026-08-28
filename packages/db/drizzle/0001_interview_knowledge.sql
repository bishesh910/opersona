CREATE TABLE "contextual_rules" (
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
	"category" text,
	"situation" text NOT NULL,
	"condition" text,
	"tendency" text NOT NULL,
	"exception_to_trait_id" uuid,
	"tier" text NOT NULL,
	"shareable" boolean DEFAULT false NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(situation,'') || ' ' || coalesce(condition,'') || ' ' || coalesce(tendency,''))) STORED
);
--> statement-breakpoint
CREATE TABLE "contradictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid NOT NULL,
	"trait_id" uuid,
	"answer_id" uuid NOT NULL,
	"description" text NOT NULL,
	"probe_question_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution_answer_id" uuid,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "interview_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"category" text NOT NULL,
	"question_text" text NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"skipped" boolean DEFAULT false NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extraction" jsonb DEFAULT 'null'::jsonb,
	"extraction_status" text DEFAULT 'pending' NOT NULL,
	"extracted_at" timestamp with time zone,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_coverage" (
	"clone_id" uuid NOT NULL,
	"category" text NOT NULL,
	"org_id" text NOT NULL,
	"coverage" real DEFAULT 0 NOT NULL,
	"facets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"answered" integer DEFAULT 0 NOT NULL,
	"open_contradictions" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interview_coverage_clone_id_category_pk" PRIMARY KEY("clone_id","category")
);
--> statement-breakpoint
CREATE TABLE "interview_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"clone_id" uuid NOT NULL,
	"category" text NOT NULL,
	"facet" text,
	"text" text NOT NULL,
	"hint" text,
	"kind" text DEFAULT 'behavioural' NOT NULL,
	"source" text DEFAULT 'bank' NOT NULL,
	"intent" text,
	"parent_answer_id" uuid,
	"contradiction_id" uuid,
	"bank_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" real DEFAULT 0 NOT NULL,
	"asked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_embeddings" (
	"item_kind" text NOT NULL,
	"item_id" uuid NOT NULL,
	"clone_id" uuid NOT NULL,
	"org_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"dim" integer NOT NULL,
	"vec" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_embeddings_item_kind_item_id_pk" PRIMARY KEY("item_kind","item_id")
);
--> statement-breakpoint
CREATE TABLE "memories" (
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
	"summary" text NOT NULL,
	"full_context" text DEFAULT '' NOT NULL,
	"importance" real DEFAULT 0.5 NOT NULL,
	"emotional_significance" real DEFAULT 0 NOT NULL,
	"people_involved" text[] DEFAULT '{}'::text[] NOT NULL,
	"date_or_period" text,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"category" text,
	"shareable" boolean DEFAULT false NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(summary,'') || ' ' || coalesce(full_context,'') || ' ' || coalesce(date_or_period,''))) STORED
);
--> statement-breakpoint
CREATE TABLE "traits" (
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
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"statement" text NOT NULL,
	"category" text,
	"tier" text NOT NULL,
	"strength" real DEFAULT 0.5 NOT NULL,
	"contexts" text[] DEFAULT '{}'::text[] NOT NULL,
	"shareable" boolean DEFAULT false NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(label,'') || ' ' || coalesce(statement,'') || ' ' || coalesce(category,''))) STORED
);
--> statement-breakpoint
CREATE INDEX "contextual_rules_clone_idx" ON "contextual_rules" USING btree ("clone_id","status");--> statement-breakpoint
CREATE INDEX "contextual_rules_tsv_idx" ON "contextual_rules" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "contradictions_clone_status_idx" ON "contradictions" USING btree ("clone_id","status");--> statement-breakpoint
CREATE INDEX "interview_answers_clone_idx" ON "interview_answers" USING btree ("clone_id","created_at");--> statement-breakpoint
CREATE INDEX "interview_answers_extract_idx" ON "interview_answers" USING btree ("clone_id","extraction_status");--> statement-breakpoint
CREATE INDEX "interview_questions_clone_status_idx" ON "interview_questions" USING btree ("clone_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_questions_bank_uq" ON "interview_questions" USING btree ("clone_id","bank_key") WHERE bank_key is not null;--> statement-breakpoint
CREATE INDEX "knowledge_embeddings_clone_idx" ON "knowledge_embeddings" USING btree ("clone_id");--> statement-breakpoint
CREATE INDEX "memories_clone_idx" ON "memories" USING btree ("clone_id","status");--> statement-breakpoint
CREATE INDEX "memories_tsv_idx" ON "memories" USING gin ("tsv");--> statement-breakpoint
CREATE UNIQUE INDEX "traits_clone_kind_key_uq" ON "traits" USING btree ("clone_id","kind","key");--> statement-breakpoint
CREATE INDEX "traits_clone_idx" ON "traits" USING btree ("clone_id","status");--> statement-breakpoint
CREATE INDEX "traits_tsv_idx" ON "traits" USING gin ("tsv");