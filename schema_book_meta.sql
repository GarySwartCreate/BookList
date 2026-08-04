-- ============================================================
-- BookList – Add publisher, subtitle, and public rating fields
-- Run this in Supabase → SQL Editor
-- ============================================================

ALTER TABLE books
  ADD COLUMN IF NOT EXISTS publisher      TEXT,
  ADD COLUMN IF NOT EXISTS subtitle       TEXT,
  ADD COLUMN IF NOT EXISTS average_rating NUMERIC,
  ADD COLUMN IF NOT EXISTS ratings_count  INTEGER;
