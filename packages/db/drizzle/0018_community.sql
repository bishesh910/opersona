-- Phase 2: publish / import / explore — the community layer.
CREATE TABLE "published_personas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" text NOT NULL,
  "clone_id" uuid NOT NULL,
  "owner_user_id" text NOT NULL,
  "slug" text NOT NULL,
  "artifact" jsonb NOT NULL,
  "sections" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "visibility" text DEFAULT 'restricted' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "import_count" integer DEFAULT 0 NOT NULL,
  "published_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "unpublished_at" timestamp with time zone,
  CONSTRAINT "published_personas_slug_uq" UNIQUE("slug"),
  CONSTRAINT "published_personas_clone_uq" UNIQUE("clone_id")
);
CREATE INDEX "published_personas_browse_idx" ON "published_personas" ("visibility","status","import_count");

CREATE TABLE "persona_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "published_id" uuid NOT NULL,
  "grantee_email" text NOT NULL,
  "grantee_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "persona_grants_uq" UNIQUE("published_id","grantee_email")
);
CREATE INDEX "persona_grants_pub_idx" ON "persona_grants" ("published_id");

CREATE TABLE "persona_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "published_id" uuid NOT NULL,
  "reporter_user_id" text,
  "reason" text NOT NULL,
  "details" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  "resolution" text
);
CREATE INDEX "persona_reports_open_idx" ON "persona_reports" ("resolved_at","created_at");

CREATE TABLE "imported_personas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" text NOT NULL,
  "clone_id" uuid NOT NULL,
  "imported_by" text NOT NULL,
  "source_published_id" uuid,
  "source_slug" text,
  "source_version" integer NOT NULL,
  "artifact" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "imported_personas_clone_uq" UNIQUE("clone_id")
);
CREATE INDEX "imported_personas_org_idx" ON "imported_personas" ("org_id");
