-- Performance indexes for hot query paths
-- Safe to re-run (IF NOT EXISTS)

-- Feed: ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS posts_created_at_idx ON posts (created_at DESC);
CREATE INDEX IF NOT EXISTS posts_user_id_created_at_idx ON posts (user_id, created_at DESC);

-- Reaction/comment counts (already covered by FK but explicit helps the planner)
CREATE INDEX IF NOT EXISTS likes_post_id_idx ON likes (post_id);
CREATE INDEX IF NOT EXISTS likes_post_user_idx ON likes (post_id, user_id);
CREATE INDEX IF NOT EXISTS comments_post_id_idx ON comments (post_id);
CREATE INDEX IF NOT EXISTS shares_post_id_idx ON shares (post_id);
CREATE INDEX IF NOT EXISTS posts_repost_of_idx ON posts (repost_of);

-- Connections lookup (used everywhere: feed avatars, search, suggestions)
CREATE INDEX IF NOT EXISTS connections_user_a_idx ON connections (user_a);
CREATE INDEX IF NOT EXISTS connections_user_b_idx ON connections (user_b);

-- Messages: thread reads filter by from/to pair and order by created_at
CREATE INDEX IF NOT EXISTS messages_pair_idx ON messages (from_id, to_id, created_at);
CREATE INDEX IF NOT EXISTS messages_to_idx ON messages (to_id, created_at);

-- Notifications: feed sidebar polls these
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications (user_id, created_at DESC);

-- Search: lowered email already indexed; add name lower for ILIKE %q%
CREATE INDEX IF NOT EXISTS users_name_lower_idx ON users (LOWER(name));
