-- ============================================================
-- BookList – Supabase Schema
-- Run this in your Supabase SQL editor (Project > SQL Editor)
-- Requires: new project created after May 30 2026
-- All tables need explicit GRANTs on newer Supabase projects
-- ============================================================

-- ─── Profiles ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username      TEXT UNIQUE,
  display_name  TEXT,
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT SELECT               ON profiles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON profiles TO authenticated;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are publicly readable"
  ON profiles FOR SELECT USING (true);

CREATE POLICY "Users can insert their own profile"
  ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

-- ─── Books (Google Books metadata cache) ─────────────────────────
CREATE TABLE IF NOT EXISTS books (
  id             TEXT PRIMARY KEY,              -- Google Books volumeId
  title          TEXT NOT NULL,
  authors        TEXT[]  DEFAULT '{}',
  description    TEXT,
  cover_url      TEXT,
  categories     TEXT[]  DEFAULT '{}',
  published_date TEXT,
  page_count     INTEGER,
  isbn           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT SELECT               ON books TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON books TO authenticated;

ALTER TABLE books ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Books are publicly readable"
  ON books FOR SELECT USING (true);

CREATE POLICY "Authenticated users can upsert books"
  ON books FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update books"
  ON books FOR UPDATE USING (auth.role() = 'authenticated');

-- ─── User Books (library) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_books (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id     TEXT        NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  status      TEXT        NOT NULL CHECK (status IN ('reading', 'read', 'want_to_read')),
  rating      SMALLINT    CHECK (rating BETWEEN 1 AND 5),
  position    INTEGER     NOT NULL DEFAULT 0,  -- sort order for want_to_read queue
  notes       TEXT,
  started_at  DATE,
  finished_at DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, book_id)
);

CREATE INDEX IF NOT EXISTS user_books_user_id_idx  ON user_books (user_id);
CREATE INDEX IF NOT EXISTS user_books_status_idx   ON user_books (user_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON user_books TO authenticated;

ALTER TABLE user_books ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own library"
  ON user_books FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert into their own library"
  ON user_books FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own library"
  ON user_books FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete from their own library"
  ON user_books FOR DELETE USING (auth.uid() = user_id);

-- Friends can view each other's libraries (for activity feed + recommendations)
CREATE POLICY "Friends can view each other's libraries"
  ON user_books FOR SELECT USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM friendships
      WHERE status = 'accepted'
        AND (
          (requester_id = auth.uid() AND addressee_id = user_id)
          OR (addressee_id = auth.uid() AND requester_id = user_id)
        )
    )
  );

-- ─── Friendships ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS friendships (
  id           UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID  NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee_id UUID  NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status       TEXT  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);

CREATE INDEX IF NOT EXISTS friendships_requester_idx ON friendships (requester_id);
CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON friendships (addressee_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON friendships TO authenticated;

ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view friendships they are part of"
  ON friendships FOR SELECT USING (
    auth.uid() = requester_id OR auth.uid() = addressee_id
  );

CREATE POLICY "Users can send friend requests"
  ON friendships FOR INSERT WITH CHECK (auth.uid() = requester_id);

CREATE POLICY "Addressee can accept or decline; requester can cancel"
  ON friendships FOR UPDATE USING (
    auth.uid() = addressee_id OR auth.uid() = requester_id
  );

CREATE POLICY "Users can remove friendships they are part of"
  ON friendships FOR DELETE USING (
    auth.uid() = requester_id OR auth.uid() = addressee_id
  );

-- ─── Book Recommendations ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS book_recommendations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id      TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  message      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS book_recs_to_user_idx ON book_recommendations (to_user_id);

GRANT SELECT, INSERT, DELETE ON book_recommendations TO authenticated;

ALTER TABLE book_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view recommendations to/from them"
  ON book_recommendations FOR SELECT USING (
    auth.uid() = from_user_id OR auth.uid() = to_user_id
  );

CREATE POLICY "Authenticated users can send recommendations"
  ON book_recommendations FOR INSERT WITH CHECK (auth.uid() = from_user_id);

CREATE POLICY "Users can delete their own recommendations"
  ON book_recommendations FOR DELETE USING (
    auth.uid() = from_user_id OR auth.uid() = to_user_id
  );

-- ─── Auto-create profile on signup ───────────────────────────────
-- Creates a bare profile row when a new user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
