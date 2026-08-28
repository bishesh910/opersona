-- opersona bridge (subscription rail): pairing tokens for the user-run daemon
-- that executes chat sessions on their own machine under their own Claude Code.
CREATE TABLE IF NOT EXISTS "bridge_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" text NOT NULL,
  "user_id" text NOT NULL,
  "name" text NOT NULL DEFAULT 'my machine',
  "token_hash" text NOT NULL UNIQUE,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "last_seen_at" timestamp,
  "revoked_at" timestamp
);
CREATE INDEX IF NOT EXISTS "bridge_tokens_org_idx" ON "bridge_tokens" ("org_id");
