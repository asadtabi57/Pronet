-- Performance follow-up (round 2)
-- Context: Supabase's "slow query" report was dominated by PLATFORM queries
-- (pg_timezone_names, pg_available_extensions, information_schema / pg_catalog
-- introspection from Studio + PostgREST/Realtime). Those hit system catalogs and
-- cannot be addressed with user indexes. Every *application* query in the report
-- already runs sub-millisecond and is fully covered by existing indexes — they
-- only rank high by total_time because of call volume, and Supabase's index
-- advisor returned NULL (no index recommended) for all of them.
--
-- This migration makes two small, real improvements and is safe to re-run.

-- 1) Symmetric partial-style index for the hot connection-count / mutual checks:
--      SELECT COUNT(*) FROM connections WHERE (user_a=$1 OR user_b=$1) AND accepted=$2
--      SELECT ... FROM connections WHERE accepted=$ AND user_a = ANY($::bigint[])
--    The user_b side is already served by connections_pending_idx (user_b, accepted);
--    add the matching (user_a, accepted) so both arms of the OR/UNION stay index-only
--    as the table grows.
CREATE INDEX IF NOT EXISTS connections_accepted_a_idx ON connections (user_a, accepted);

-- 2) Drop exact-duplicate indexes (identical definition to another index). They add
--    write/VACUUM overhead and storage for zero read benefit.
--    a) notifications_user_idx == notifications_user_created_idx  (user_id, created_at DESC)
DROP INDEX IF EXISTS notifications_user_idx;
--    b) users_supabase_id_idx duplicates the UNIQUE-constraint index users_supabase_id_key
DROP INDEX IF EXISTS users_supabase_id_idx;
