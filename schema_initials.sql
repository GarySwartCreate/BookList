-- ============================================================
-- BookList – Custom display initials
-- Run this in Supabase → SQL Editor
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS initials TEXT;
