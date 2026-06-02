-- Email verification + future-proofing
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_expires BIGINT;

-- Treat all existing rows as verified so seeded data + Supabase OAuth users
-- aren't suddenly locked out. Going forward, new password signups must verify.
UPDATE users SET email_verified = TRUE WHERE email_verified = FALSE;

CREATE INDEX IF NOT EXISTS users_verify_token_idx ON users (email_verify_token);
