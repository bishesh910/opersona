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
CREATE INDEX "self_tests_clone_idx" ON "self_tests" USING btree ("clone_id","created_at");