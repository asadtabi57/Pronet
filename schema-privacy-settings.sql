-- Privacy & account settings for the "Settings & Privacy" menu.
-- Idempotent so it is safe to re-run on every deploy.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_online_visible    BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_last_seen_visible BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_visibility   TEXT    NOT NULL DEFAULT 'public';

-- Constrain profile_visibility to the two supported values. Added separately
-- (and guarded) so re-runs don't error if the constraint already exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_profile_visibility_chk'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_profile_visibility_chk
      CHECK (profile_visibility IN ('public','private'));
  END IF;
END $$;
