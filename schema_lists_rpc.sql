-- ============================================================
-- BookList – Shared Lists: RPC functions for mutations
-- Run this in Supabase → SQL Editor (after schema_lists.sql)
--
-- Direct client-side inserts/updates against book_lists,
-- book_list_items, and book_list_shares were being rejected by RLS
-- even with an unconditional `WITH CHECK (true)` policy — every
-- structural check (grants, triggers, table identity, auth.uid()
-- resolution, FORCE ROW LEVEL SECURITY) came back clean, so the exact
-- cause couldn't be pinned down. Routing all Lists mutations through
-- SECURITY DEFINER functions sidesteps the issue: each function does
-- its own explicit membership/ownership check internally instead of
-- relying on table-level RLS for writes.
-- ============================================================

-- Restore a real (non-"allow everything") policy on book_lists now that
-- writes go through the functions below instead of a direct client insert.
-- This also cleans up the "TEMP allow all inserts" policy from debugging.
DROP POLICY IF EXISTS "TEMP allow all inserts" ON book_lists;
DROP POLICY IF EXISTS "Users can create their own lists" ON book_lists;
CREATE POLICY "Users can create their own lists"
  ON book_lists FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE OR REPLACE FUNCTION create_book_list(p_name TEXT, p_description TEXT DEFAULT NULL)
RETURNS book_lists
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_row book_lists;
BEGIN
  INSERT INTO book_lists (owner_id, name, description)
  VALUES (auth.uid(), p_name, p_description)
  RETURNING * INTO new_row;
  RETURN new_row;
END;
$$;

GRANT EXECUTE ON FUNCTION create_book_list(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION add_book_to_list(p_list_id UUID, p_book_id TEXT, p_status TEXT DEFAULT 'want_to_read')
RETURNS book_list_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_row book_list_items;
BEGIN
  IF NOT is_list_member(p_list_id) THEN
    RAISE EXCEPTION 'Not a member of this list';
  END IF;
  INSERT INTO book_list_items (list_id, book_id, status, added_by)
  VALUES (p_list_id, p_book_id, COALESCE(p_status, 'want_to_read'), auth.uid())
  RETURNING * INTO new_row;
  RETURN new_row;
END;
$$;

GRANT EXECUTE ON FUNCTION add_book_to_list(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION update_list_item_status(p_item_id UUID, p_status TEXT)
RETURNS book_list_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_list_id UUID;
  updated_row book_list_items;
BEGIN
  SELECT list_id INTO target_list_id FROM book_list_items WHERE id = p_item_id;
  IF target_list_id IS NULL OR NOT is_list_member(target_list_id) THEN
    RAISE EXCEPTION 'Not a member of this list';
  END IF;
  UPDATE book_list_items SET status = p_status WHERE id = p_item_id
  RETURNING * INTO updated_row;
  RETURN updated_row;
END;
$$;

GRANT EXECUTE ON FUNCTION update_list_item_status(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION remove_list_item(p_item_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_list_id UUID;
BEGIN
  SELECT list_id INTO target_list_id FROM book_list_items WHERE id = p_item_id;
  IF target_list_id IS NULL OR NOT is_list_member(target_list_id) THEN
    RAISE EXCEPTION 'Not a member of this list';
  END IF;
  DELETE FROM book_list_items WHERE id = p_item_id;
END;
$$;

GRANT EXECUTE ON FUNCTION remove_list_item(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION share_list_with(p_list_id UUID, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM book_lists WHERE id = p_list_id AND owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the owner can manage sharing';
  END IF;
  INSERT INTO book_list_shares (list_id, user_id) VALUES (p_list_id, p_user_id)
  ON CONFLICT (list_id, user_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION share_list_with(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION unshare_list(p_list_id UUID, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM book_lists WHERE id = p_list_id AND owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the owner can manage sharing';
  END IF;
  DELETE FROM book_list_shares WHERE list_id = p_list_id AND user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION unshare_list(UUID, UUID) TO authenticated;
