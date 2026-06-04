-- Last-seen presence timestamp for the chat header ("last seen 5m ago").
-- Updated server-side whenever a user's final realtime connection drops.
-- Idempotent so it is safe to re-run on every deploy.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen BIGINT;

-- Read receipts reuse the existing messages.read flag (0 = sent/grey single
-- tick, 1 = seen/blue double tick); no new column is required.
