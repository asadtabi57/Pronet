-- Rich profile features: views, endorsements, projects, certifications, and a
-- few new user columns. Idempotent — safe to re-run on every deploy.

-- New user columns for the redesigned profile.
ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_url      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS open_to_work   SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS open_to_work_roles TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS languages      JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS interests      JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS featured_post_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Persistent profile-view log (drives the "Who viewed your profile" card + count).
-- We keep one row per (owner, viewer) and bump last_viewed_at / count on repeat
-- visits so the list shows distinct viewers, most-recent first.
CREATE TABLE IF NOT EXISTS profile_views (
  owner_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewer_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  anonymous      SMALLINT NOT NULL DEFAULT 0,
  view_count     INT NOT NULL DEFAULT 1,
  last_viewed_at BIGINT NOT NULL,
  PRIMARY KEY (owner_id, viewer_id),
  CHECK (owner_id <> viewer_id)
);
CREATE INDEX IF NOT EXISTS profile_views_owner_idx ON profile_views (owner_id, last_viewed_at DESC);

-- Skill endorsements: a connection vouches for a specific skill on someone's
-- profile. One endorsement per (profile owner, skill, endorser).
CREATE TABLE IF NOT EXISTS endorsements (
  id          BIGSERIAL PRIMARY KEY,
  owner_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endorser_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill       TEXT NOT NULL,
  created_at  BIGINT NOT NULL,
  UNIQUE (owner_id, endorser_id, skill),
  CHECK (owner_id <> endorser_id)
);
CREATE INDEX IF NOT EXISTS endorsements_owner_idx ON endorsements (owner_id);

-- Projects / portfolio items.
CREATE TABLE IF NOT EXISTS projects (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  url         TEXT,
  image_url   TEXT,
  tags        JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_user_idx ON projects (user_id, sort_order);

-- Licenses & certifications.
CREATE TABLE IF NOT EXISTS certifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  issuer      TEXT,
  issue_date  TEXT,
  credential_url TEXT,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS certifications_user_idx ON certifications (user_id, created_at DESC);
