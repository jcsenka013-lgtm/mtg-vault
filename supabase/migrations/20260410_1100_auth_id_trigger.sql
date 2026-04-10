-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260410_1100_auth_id_trigger
-- Purpose:   Bridge Supabase Auth users to the `players` table so co-workers
--            can sign up and have their tournament history automatically linked.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add auth_id column to players table (nullable so pre-seeded rows still work)
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Index for fast auth_id lookups (used by RLS policies and the dashboard)
CREATE INDEX IF NOT EXISTS idx_players_auth_id ON public.players(auth_id);

-- 3. Trigger function: fires after every new Supabase Auth signup.
--    Logic:
--      A) If their display_name (from raw_user_meta_data) matches a seeded player row
--         (case-insensitive), link that row to their new auth.uid().
--      B) If no match, insert a brand-new player row with their display_name.
--    This guarantees Geoff's 0-1 draft record is instantly linked the moment he
--    creates his account — no manual admin step needed.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_display_name TEXT;
  v_existing_player_id UUID;
BEGIN
  -- Extract display_name from Supabase Auth metadata (set during sign-up)
  v_display_name := TRIM(new.raw_user_meta_data ->> 'display_name');

  -- Fall back to the part of the email before the @ if no display_name was provided
  IF v_display_name IS NULL OR v_display_name = '' THEN
    v_display_name := SPLIT_PART(new.email, '@', 1);
  END IF;

  -- Try to find a pre-seeded player whose name matches (case-insensitive)
  SELECT id INTO v_existing_player_id
  FROM public.players
  WHERE LOWER(name) = LOWER(v_display_name)
    AND auth_id IS NULL  -- only link un-claimed rows
  LIMIT 1;

  IF v_existing_player_id IS NOT NULL THEN
    -- ✅ Match found — link the existing player row to this auth user
    UPDATE public.players
    SET auth_id = new.id
    WHERE id = v_existing_player_id;
  ELSE
    -- 🆕 No match — insert a fresh player row for this new community member
    INSERT INTO public.players (name, auth_id)
    VALUES (v_display_name, new.id)
    ON CONFLICT (auth_id) DO NOTHING;
  END IF;

  RETURN new;
END;
$$;

-- 4. Attach the trigger to auth.users (fires once per new signup)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 5. Enable RLS on players table if not already enabled
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies:
--    - Anyone authenticated can read all player rows (needed for leaderboard)
--    - Users can only update their OWN player row (e.g., deck colors)
DROP POLICY IF EXISTS "players_read_all" ON public.players;
CREATE POLICY "players_read_all"
  ON public.players FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "players_update_own" ON public.players;
CREATE POLICY "players_update_own"
  ON public.players FOR UPDATE
  TO authenticated
  USING (auth_id = auth.uid())
  WITH CHECK (auth_id = auth.uid());

-- 7. Allow trigger function (SECURITY DEFINER) to insert new player rows on signup
DROP POLICY IF EXISTS "players_insert_trigger" ON public.players;
CREATE POLICY "players_insert_trigger"
  ON public.players FOR INSERT
  TO authenticated
  WITH CHECK (true);
