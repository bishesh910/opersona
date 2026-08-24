ALTER TABLE "conversations" ADD COLUMN "slug" text;
UPDATE "conversations" SET "slug" = substr(md5(random()::text || id::text), 1, 7) WHERE "slug" IS NULL;
ALTER TABLE "conversations" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_slug_unique" UNIQUE("slug");