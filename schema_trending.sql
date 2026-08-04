-- ============================================================
-- BookList – Trending books (privacy-safe aggregate)
-- Run this in Supabase → SQL Editor
--
-- RLS on user_books only lets a user see their own + friends' rows,
-- so there's no way to compute platform-wide "trending" from the
-- client. This function runs as SECURITY DEFINER (bypasses RLS) but
-- only ever returns aggregate counts per book — no user identities,
-- statuses, ratings, or notes are exposed.
-- ============================================================

CREATE OR REPLACE FUNCTION get_trending_books(days_back INT DEFAULT 60, limit_count INT DEFAULT 20)
RETURNS TABLE(book_id TEXT, adds BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT book_id, COUNT(*) AS adds
  FROM user_books
  WHERE created_at > NOW() - (days_back || ' days')::interval
  GROUP BY book_id
  ORDER BY adds DESC
  LIMIT limit_count;
$$;

GRANT EXECUTE ON FUNCTION get_trending_books(INT, INT) TO authenticated, anon;
