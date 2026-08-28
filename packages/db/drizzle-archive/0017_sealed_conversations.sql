-- Sealed conversations: the server stores only a fingerprint of the user-held
-- key (for mismatch detection) and the moment sealing was enabled.
ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS seal_key_fp text;
ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS sealed_at timestamp;
