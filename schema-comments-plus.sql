-- Comment replies + comment likes (idempotent)
ALTER TABLE comments ADD COLUMN IF NOT EXISTS parent_id BIGINT REFERENCES comments(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS comments_parent_idx ON comments (parent_id);

CREATE TABLE IF NOT EXISTS comment_likes (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment_id  BIGINT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  created_at  BIGINT NOT NULL,
  PRIMARY KEY (user_id, comment_id)
);
CREATE INDEX IF NOT EXISTS comment_likes_comment_idx ON comment_likes (comment_id);
