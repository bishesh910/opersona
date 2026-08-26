-- The office boss (starred persona) + temporary hired personas
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "boss_clone_id" uuid;
ALTER TABLE "clones" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'member';
ALTER TABLE "clones" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
DROP INDEX IF EXISTS "clones_org_owner_uq";
CREATE UNIQUE INDEX IF NOT EXISTS "clones_org_owner_uq" ON "clones" ("org_id","owner_user_id") WHERE "kind" = 'member';
