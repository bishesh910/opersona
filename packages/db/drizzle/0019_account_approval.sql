-- Admission control: new accounts wait for platform-admin approval.
-- Existing accounts are grandfathered in.
ALTER TABLE "user" ADD COLUMN "approved_at" timestamp with time zone;
UPDATE "user" SET "approved_at" = now();
