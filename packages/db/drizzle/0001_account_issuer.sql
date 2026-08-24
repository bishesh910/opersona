-- better-auth 1.7: account identity is scoped by issuer (see 1-7-upgrade-guide#account-identity-is-scoped-by-issuer).
-- Backfill existing credential accounts with the synthetic local issuer before making the column NOT NULL.
ALTER TABLE "account" ADD COLUMN "issuer" text;--> statement-breakpoint
UPDATE "account" SET "issuer" = 'local:' || "provider_id" WHERE "issuer" IS NULL;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON "account" USING btree ("issuer","account_id");
