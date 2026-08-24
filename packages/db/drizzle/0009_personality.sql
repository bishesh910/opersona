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
CREATE INDEX "personality_clone_idx" ON "personality_tests" USING btree ("clone_id","created_at");