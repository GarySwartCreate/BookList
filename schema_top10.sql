-- ============================================================
-- BookList – Add top_10 column to user_books
-- Run this in Supabase → SQL Editor
-- ============================================================

ALTER TABLE user_books
  ADD COLUMN IF NOT EXISTS top_10 BOOLEAN NOT NULL DEFAULT FALSE;
