-- Pronet schema (Postgres / Supabase)
-- Drop in reverse-dependency order so re-runs are clean during development
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS shares CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS connections CASCADE;
DROP TABLE IF EXISTS comments CASCADE;
DROP TABLE IF EXISTS likes CASCADE;
DROP TABLE IF EXISTS posts CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
  id              BIGSERIAL PRIMARY KEY,
  supabase_id     TEXT UNIQUE,
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT,
  name            TEXT NOT NULL,
  headline        TEXT,
  about           TEXT,
  location        TEXT,
  experience      JSONB NOT NULL DEFAULT '[]'::jsonb,
  education       JSONB NOT NULL DEFAULT '[]'::jsonb,
  skills          JSONB NOT NULL DEFAULT '[]'::jsonb,
  avatar_color    TEXT,
  cover_color     TEXT,
  avatar_url      TEXT,
  subscription    JSONB,
  created_at      BIGINT NOT NULL
);
CREATE INDEX users_email_idx ON users (LOWER(email));
CREATE INDEX users_supabase_id_idx ON users (supabase_id);

CREATE TABLE posts (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  media_type  TEXT,
  media_url   TEXT,
  repost_of   BIGINT REFERENCES posts(id) ON DELETE SET NULL,
  created_at  BIGINT NOT NULL
);
CREATE INDEX posts_user_id_idx ON posts (user_id);
CREATE INDEX posts_created_at_idx ON posts (created_at DESC);

CREATE TABLE likes (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  type        TEXT NOT NULL DEFAULT 'like',
  created_at  BIGINT NOT NULL,
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX likes_post_id_idx ON likes (post_id);

CREATE TABLE comments (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  created_at  BIGINT NOT NULL
);
CREATE INDEX comments_post_id_idx ON comments (post_id);

CREATE TABLE connections (
  user_a      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a <> user_b)
);
CREATE INDEX connections_user_b_idx ON connections (user_b);

CREATE TABLE messages (
  id                BIGSERIAL PRIMARY KEY,
  from_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content           TEXT NOT NULL,
  attached_post_id  BIGINT REFERENCES posts(id) ON DELETE SET NULL,
  created_at        BIGINT NOT NULL,
  read              SMALLINT NOT NULL DEFAULT 0
);
CREATE INDEX messages_pair_idx ON messages (from_id, to_id, created_at);
CREATE INDEX messages_to_unread_idx ON messages (to_id) WHERE read = 0;

CREATE TABLE notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  actor_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  payload     JSONB,
  read        SMALLINT NOT NULL DEFAULT 0,
  created_at  BIGINT NOT NULL
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE shares (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at  BIGINT NOT NULL
);

CREATE TABLE payments (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id     TEXT NOT NULL,
  amount      NUMERIC(10,2) NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'USD',
  method      TEXT,
  status      TEXT NOT NULL,
  brand       TEXT,
  last4       TEXT,
  gateway     TEXT,
  gateway_id  TEXT,
  message     TEXT,
  wallet      JSONB,
  created_at  BIGINT NOT NULL
);
CREATE INDEX payments_user_idx ON payments (user_id);
