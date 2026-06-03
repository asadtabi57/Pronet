-- Track whether a comment/message was edited (for the "(edited)" indicator).
-- Idempotent so it can be applied safely on every deploy.
ALTER TABLE comments ADD COLUMN IF NOT EXISTS edited SMALLINT DEFAULT 0;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited SMALLINT DEFAULT 0;
