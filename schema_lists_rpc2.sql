-- ============================================================
-- BookList – Shared Lists: additional RPC functions
-- Run this in Supabase → SQL Editor (after schema_lists_rpc.sql)
--
-- Adds: deleting a list (owner-only), and persisting drag-reorder
-- position within a list's Want to Read section. Same SECURITY
-- DEFINER pattern as the rest of the Lists RPC functions.
-- ============================================================

CREATE OR REPLACE FUNCTION update_book_list(p_list_id UUID, p_name TEXT, p_description TEXT DEFAULT NULL)
RETURNS book_lists
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_row book_lists;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM book_lists WHERE id = p_list_id AND owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the owner can rename this list';
  END IF;
  UPDATE book_lists SET name = p_name, description = p_description WHERE id = p_list_id
  RETURNING * INTO updated_row;
  RETURN updated_row;
END;
$$;

GRANT EXECUTE ON FUNCTION update_book_list(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION delete_book_list(p_list_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM book_lists WHERE id = p_list_id AND owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the owner can delete this list';
  END IF;
  DELETE FROM book_lists WHERE id = p_list_id;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_book_list(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION update_list_item_position(p_item_id UUID, p_position INT)
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
  UPDATE book_list_items SET position = p_position WHERE id = p_item_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_list_item_position(UUID, INT) TO authenticated;
