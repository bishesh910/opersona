-- Platform pivot phase 3: opersona.me as an OAuth 2.1 authorization server for
-- the claude.ai MCP connector (@better-auth/mcp = oauth-provider + RFC 9728).
-- Table/column shapes mirror @better-auth/oauth-provider@1.7.1 + jwt plugin.

ALTER TABLE "twoFactor" ADD COLUMN IF NOT EXISTS "verified" boolean;
ALTER TABLE "twoFactor" ADD COLUMN IF NOT EXISTS "failed_verification_count" integer;
ALTER TABLE "twoFactor" ADD COLUMN IF NOT EXISTS "locked_until" timestamp;

CREATE TABLE IF NOT EXISTS "jwks" (
  "id" text PRIMARY KEY,
  "public_key" text NOT NULL,
  "private_key" text NOT NULL,
  "created_at" timestamp NOT NULL,
  "expires_at" timestamp,
  "alg" text,
  "crv" text
);

CREATE TABLE IF NOT EXISTS "oauthClient" (
  "id" text PRIMARY KEY,
  "client_id" text NOT NULL UNIQUE,
  "client_secret" text,
  "client_discovery_id" text,
  "disabled" boolean,
  "skip_consent" boolean,
  "enable_end_session" boolean,
  "subject_type" text,
  "scopes" text[],
  "client_credentials_scopes" text[],
  "user_id" text REFERENCES "user"("id") ON DELETE CASCADE,
  "created_at" timestamp,
  "updated_at" timestamp,
  "name" text,
  "uri" text,
  "icon" text,
  "contacts" text[],
  "tos" text,
  "policy" text,
  "software_id" text,
  "software_version" text,
  "software_statement" text,
  "redirect_uris" text[] NOT NULL,
  "post_logout_redirect_uris" text[],
  "backchannel_logout_uri" text,
  "backchannel_logout_session_required" boolean,
  "token_endpoint_auth_method" text,
  "application_type" text,
  "jwks" text,
  "jwks_uri" text,
  "grant_types" text[],
  "response_types" text[],
  "require_pkce" boolean,
  "dpop_bound_access_tokens" boolean,
  "reference_id" text,
  "metadata" jsonb
);

CREATE TABLE IF NOT EXISTS "oauthResource" (
  "id" text PRIMARY KEY,
  "identifier" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "access_token_ttl" integer,
  "refresh_token_ttl" integer,
  "signing_algorithm" text,
  "signing_key_id" text,
  "allowed_scopes" text[],
  "custom_claims" jsonb,
  "dpop_bound_access_tokens_required" boolean,
  "disabled" boolean,
  "created_at" timestamp,
  "updated_at" timestamp,
  "policy_version" integer,
  "metadata" jsonb
);

CREATE TABLE IF NOT EXISTS "oauthClientResource" (
  "id" text PRIMARY KEY,
  "client_id" text NOT NULL REFERENCES "oauthClient"("client_id") ON DELETE CASCADE,
  "resource_id" text NOT NULL REFERENCES "oauthResource"("identifier") ON DELETE CASCADE,
  "metadata" jsonb,
  "created_at" timestamp
);

CREATE TABLE IF NOT EXISTS "oauthRefreshToken" (
  "id" text PRIMARY KEY,
  "token" text UNIQUE,
  "client_id" text NOT NULL REFERENCES "oauthClient"("client_id"),
  "session_id" text REFERENCES "session"("id") ON DELETE SET NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "reference_id" text,
  "authorization_code_id" text,
  "resources" text[],
  "requested_user_info_claims" text[],
  "expires_at" timestamp,
  "created_at" timestamp,
  "revoked" timestamp,
  "rotated_at" timestamp,
  "rotation_replay_response" text,
  "rotation_replay_expires_at" timestamp,
  "auth_time" timestamp,
  "confirmation" jsonb,
  "scopes" text[] NOT NULL
);

CREATE TABLE IF NOT EXISTS "oauthAccessToken" (
  "id" text PRIMARY KEY,
  "token" text UNIQUE,
  "client_id" text NOT NULL REFERENCES "oauthClient"("client_id"),
  "session_id" text REFERENCES "session"("id") ON DELETE SET NULL,
  "user_id" text REFERENCES "user"("id") ON DELETE CASCADE,
  "reference_id" text,
  "authorization_code_id" text,
  "resources" text[],
  "requested_user_info_claims" text[],
  "refresh_id" text REFERENCES "oauthRefreshToken"("id") ON DELETE CASCADE,
  "expires_at" timestamp,
  "created_at" timestamp,
  "revoked" timestamp,
  "confirmation" jsonb,
  "scopes" text[] NOT NULL
);

CREATE TABLE IF NOT EXISTS "oauthConsent" (
  "id" text PRIMARY KEY,
  "client_id" text NOT NULL REFERENCES "oauthClient"("client_id"),
  "user_id" text REFERENCES "user"("id") ON DELETE CASCADE,
  "reference_id" text,
  "resources" text[],
  "requested_user_info_claims" text[],
  "scopes" text[] NOT NULL,
  "created_at" timestamp,
  "updated_at" timestamp
);

CREATE TABLE IF NOT EXISTS "oauthClientAssertion" (
  "id" text PRIMARY KEY,
  "expires_at" timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS "oauthRefreshToken_user_idx" ON "oauthRefreshToken" ("user_id");
CREATE INDEX IF NOT EXISTS "oauthAccessToken_user_idx" ON "oauthAccessToken" ("user_id");
CREATE INDEX IF NOT EXISTS "oauthConsent_user_idx" ON "oauthConsent" ("user_id");
