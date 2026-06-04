-- Reply-to-message + emoji reactions for 1:1 chat (WhatsApp-style).
-- Idempotent so it is safe to re-run on every deploy.

-- A message can quote another message in the same conversation. ON DELETE SET
-- NULL keeps the reply around (showing "original deleted") if the quoted
-- message is later removed.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id BIGINT REFERENCES messages(id) ON DELETE SET NULL;

-- One emoji reaction per user per message. Tapping the same emoji again removes
-- it; tapping a different emoji replaces it (enforced via the UNIQUE pair +
-- ON CONFLICT upsert in the API).
CREATE TABLE IF NOT EXISTS message_reactions (
  id          BIGSERIAL PRIMARY KEY,
  message_id  BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       TEXT NOT NULL,
  created_at  BIGINT NOT NULL,
  UNIQUE (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS message_reactions_msg_idx ON message_reactions (message_id);
