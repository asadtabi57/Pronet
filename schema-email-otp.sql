-- Email verification OTP codes (signup). Mirrors password_reset_otps so the
-- whole app stays on the same BIGINT-epoch convention used everywhere else
-- (the app stores timestamps as Date.now() milliseconds, not timestamptz).
CREATE TABLE IF NOT EXISTS email_otps (
  id         BIGSERIAL PRIMARY KEY,
  email      TEXT     NOT NULL,
  otp_hash   TEXT     NOT NULL,
  purpose    TEXT     NOT NULL DEFAULT 'signup',
  expires_at BIGINT   NOT NULL,
  used       SMALLINT NOT NULL DEFAULT 0,
  attempts   SMALLINT NOT NULL DEFAULT 0,
  created_at BIGINT   NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_email_otps_email   ON email_otps (email);
CREATE INDEX IF NOT EXISTS idx_email_otps_created ON email_otps (created_at);
