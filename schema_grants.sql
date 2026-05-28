-- ============================================================
-- BookList – Fix profiles RLS + grants
-- Run this in Supabase → SQL Editor
-- ============================================================

-- Ensure avatar_url column exists
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT '';

-- Grant full access to authenticated users
GRANT SELECT, INSERT, UPDATE ON profiles TO authenticated;

-- Add insert policy (allows users to create their own profile row)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles' AND policyname = 'Users can insert their own profile'
  ) THEN
    EXECUTE 'CREATE POLICY "Users can insert their own profile"
      ON profiles FOR INSERT WITH CHECK (auth.uid() = id)';
  END IF;
END $$;
