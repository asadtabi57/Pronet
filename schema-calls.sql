-- 1-to-1 calls (audio/video/screen-share) — Pronet
-- WebRTC is peer-to-peer; we only persist call records/logs + signaling.
CREATE TABLE IF NOT EXISTS calls (
  id               BIGSERIAL PRIMARY KEY,
  caller_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_type        TEXT NOT NULL CHECK (call_type IN ('audio','video')),
  status           TEXT NOT NULL DEFAULT 'ringing'
                     CHECK (status IN ('ringing','accepted','rejected','missed','ended','failed')),
  started_at       BIGINT,
  ended_at         BIGINT,
  duration_seconds INT,
  created_at       BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS calls_caller_idx   ON calls (caller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS calls_receiver_idx ON calls (receiver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS calls_created_idx  ON calls (created_at);

-- Transient signaling messages (offer/answer/ICE/screen events). Short-lived.
CREATE TABLE IF NOT EXISTS call_signals (
  id           BIGSERIAL PRIMARY KEY,
  call_id      BIGINT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  sender_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  payload      JSONB NOT NULL,
  created_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS call_signals_call_idx    ON call_signals (call_id, created_at);
CREATE INDEX IF NOT EXISTS call_signals_created_idx ON call_signals (created_at);
