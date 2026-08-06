-- ============================================================
-- BookList – Shared Lists (book club style)
-- Run this in Supabase → SQL Editor
--
-- A list is a named collection of books, owned by one user and shared
-- with any number of friends. Each item on a list has its own status
-- (reading / want_to_read / read) — separate from anyone's personal
-- shelf — so a shared list renders with the same Reading/Want to
-- Read/Read layout as a personal library, but represents the group's
-- plan rather than any one person's.
--
-- Anyone the list is shared with (a "member") can add books and change
-- their status. Only the owner can rename/delete the list or manage
-- who it's shared with.
-- ============================================================

-- ─── Lists ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS book_lists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS book_lists_owner_idx ON book_lists (owner_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON book_lists TO authenticated;

ALTER TABLE book_lists ENABLE ROW LEVEL SECURITY;

-- ─── List members (who a list is shared with) ────────────────────
CREATE TABLE IF NOT EXISTS book_list_shares (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id    UUID NOT NULL REFERENCES book_lists(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (list_id, user_id)
);

CREATE INDEX IF NOT EXISTS book_list_shares_list_idx ON book_list_shares (list_id);
CREATE INDEX IF NOT EXISTS book_list_shares_user_idx ON book_list_shares (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON book_list_shares TO authenticated;

ALTER TABLE book_list_shares ENABLE ROW LEVEL SECURITY;

-- ─── List items (the books on a list, each with its own status) ──
CREATE TABLE IF NOT EXISTS book_list_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id    UUID NOT NULL REFERENCES book_lists(id) ON DELETE CASCADE,
  book_id    TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'want_to_read' CHECK (status IN ('reading', 'read', 'want_to_read')),
  position   INTEGER NOT NULL DEFAULT 0,
  added_by   UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (list_id, book_id)
);

CREATE INDEX IF NOT EXISTS book_list_items_list_idx ON book_list_items (list_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON book_list_items TO authenticated;

ALTER TABLE book_list_items ENABLE ROW LEVEL SECURITY;

-- ─── Membership helper (owner or shared-with) ─────────────────────
-- SECURITY DEFINER so it can check book_lists / book_list_shares without
-- re-triggering RLS on those tables from inside their own policies.
CREATE OR REPLACE FUNCTION is_list_member(target_list_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM book_lists l
    WHERE l.id = target_list_id AND l.owner_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM book_list_shares s
    WHERE s.list_id = target_list_id AND s.user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION is_list_member(UUID) TO authenticated;

-- ─── book_lists policies ───────────────────────────────────────────
CREATE POLICY "Members can view lists they belong to"
  ON book_lists FOR SELECT USING (is_list_member(id));

CREATE POLICY "Users can create their own lists"
  ON book_lists FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Owner can update their own list"
  ON book_lists FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "Owner can delete their own list"
  ON book_lists FOR DELETE USING (owner_id = auth.uid());

-- ─── book_list_shares policies ─────────────────────────────────────
CREATE POLICY "Members can view a list's shares"
  ON book_list_shares FOR SELECT USING (is_list_member(list_id));

CREATE POLICY "Owner can manage who a list is shared with"
  ON book_list_shares FOR ALL USING (
    EXISTS (SELECT 1 FROM book_lists l WHERE l.id = list_id AND l.owner_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM book_lists l WHERE l.id = list_id AND l.owner_id = auth.uid())
  );

-- ─── book_list_items policies ──────────────────────────────────────
-- Any member (owner or shared-with) can add books and change their status.
CREATE POLICY "Members can view a list's items"
  ON book_list_items FOR SELECT USING (is_list_member(list_id));

CREATE POLICY "Members can add books to a list"
  ON book_list_items FOR INSERT WITH CHECK (is_list_member(list_id));

CREATE POLICY "Members can update a list's items"
  ON book_list_items FOR UPDATE USING (is_list_member(list_id));

CREATE POLICY "Members can remove a list's items"
  ON book_list_items FOR DELETE USING (is_list_member(list_id));
