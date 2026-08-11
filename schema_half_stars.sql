-- ============================================================
-- BookList – Allow half-star ratings (1, 1.5, 2 ... 5)
-- Run this in Supabase → SQL Editor
--
-- Changes user_books.rating from SMALLINT (whole numbers only) to
-- NUMERIC(2,1), and updates the check constraint to allow half-star
-- increments only (rejects things like 4.3).
-- ============================================================

ALTER TABLE user_books
  ALTER COLUMN rating TYPE NUMERIC(2,1) USING rating::NUMERIC(2,1);

ALTER TABLE user_books
  DROP CONSTRAINT IF EXISTS user_books_rating_check;

ALTER TABLE user_books
  ADD CONSTRAINT user_books_rating_check
  CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5 AND rating * 2 = FLOOR(rating * 2)));
