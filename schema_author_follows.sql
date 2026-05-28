-- ============================================================
-- BookList – Add author_follows table
-- Run this in Supabase → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS author_follows (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, author)
);

GRANT SELECT, INSERT, DELETE ON author_follows TO authenticated;

ALTER TABLE author_follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own author follows"
  ON author_follows USING (auth.uid() = user_id);
