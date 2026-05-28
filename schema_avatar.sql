-- ============================================================
-- BookList – Add avatar_url to profiles
-- Run this in Supabase → SQL Editor
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT '';
