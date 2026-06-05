-- AI feature tables (non-vector). Idempotent — safe to run on every deploy.
-- Vector setup (pgvector extension + users.embedding column + index) is handled
-- separately in apply-ai-schema.js because it may require enabling the
-- extension and must degrade gracefully if unavailable.

-- Daily "Network TL;DR" — one current AI summary per user (upserted).
CREATE TABLE IF NOT EXISTS feed_summaries (
  user_id     BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  summary     TEXT NOT NULL,
  post_count  INT  NOT NULL DEFAULT 0,
  seen        SMALLINT NOT NULL DEFAULT 0,
  created_at  BIGINT NOT NULL
);

-- B2B Lead Scorer — posts the AI flagged as buying/hiring/transition intent.
CREATE TABLE IF NOT EXISTS lead_signals (
  id          BIGSERIAL PRIMARY KEY,
  post_id     BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL,            -- 'job_search' | 'tool_need' | 'career_transition'
  confidence  TEXT,                     -- 'high' | 'medium' | 'low'
  snippet     TEXT,
  created_at  BIGINT NOT NULL,
  UNIQUE (post_id)
);
CREATE INDEX IF NOT EXISTS lead_signals_created_idx ON lead_signals (created_at DESC);
CREATE INDEX IF NOT EXISTS lead_signals_type_idx ON lead_signals (signal_type);

-- Track which provider produced each user's embedding so we never compare
-- vectors across incompatible spaces ('gemini' semantic vs 'local' lexical).
ALTER TABLE users ADD COLUMN IF NOT EXISTS embedding_provider TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS embedding_updated_at BIGINT;
