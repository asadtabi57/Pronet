-- One-to-one chat file attachments (images, pdf, docs, audio, video, zip — max 5 MB).
-- The binary lives in Supabase Storage (avatars bucket, `chat/` prefix); these
-- columns hold the public URL + metadata so a message can carry text, a file, or both.
-- Idempotent so it is safe to re-run on every deploy.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_url  TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_type TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_name TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_size BIGINT;
