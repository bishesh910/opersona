ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "cwd" text;
ALTER TABLE "turns" ADD COLUMN IF NOT EXISTS "files" jsonb;
