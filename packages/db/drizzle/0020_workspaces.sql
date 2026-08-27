-- Power sessions: which granted folder a conversation runs in, and the resume
-- binding tuple so an SDK session is only resumed in the SAME workspace it was minted in.
ALTER TABLE "conversations" ADD COLUMN "workspace" text;      -- absolute granted path, null = sandbox
ALTER TABLE "conversations" ADD COLUMN "resume_cwd" text;     -- cwd the sdk_session_id belongs to
