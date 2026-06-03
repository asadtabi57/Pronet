-- Password reset OTP storage (Pronet)
-- One-time, hashed 6-digit codes with short expiry.
CREATE TABLE IF NOT EXISTS password_reset_otps (
  id          BIGSERIAL PRIMARY KEY,
  email       TEXT NOT NULL,
  otp_hash    TEXT NOT NULL,
  expires_at  BIGINT NOT NULL,
  used        SMALLINT NOT NULL DEFAULT 0,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS password_reset_email_idx ON password_reset_otps (email, created_at DESC);
