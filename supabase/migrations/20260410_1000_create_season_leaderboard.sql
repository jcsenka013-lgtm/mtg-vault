-- ============================================================
-- Monthly Season Leaderboard Schema
-- MTG Vault — April 2026
-- ============================================================


-- ── 1. PLAYERS ───────────────────────────────────────────────
-- Fixed club roster. Standalone — not tied to auth.users.

CREATE TABLE IF NOT EXISTS public.players (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

-- Leaderboard is visible to everyone (including unauthenticated reads)
CREATE POLICY "players_public_read" ON public.players
  FOR SELECT USING (true);

-- Only authenticated users can manage the roster
CREATE POLICY "players_auth_write" ON public.players
  FOR ALL
  USING      (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Seed the fixed 6-player roster
INSERT INTO public.players (name) VALUES
  ('JC'),
  ('Leslie'),
  ('Richard'),
  ('Ben'),
  ('Geoff'),
  ('Garrett')
ON CONFLICT (name) DO NOTHING;


-- ── 2. SEASONS ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.seasons (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT NOT NULL,          -- e.g. 'April 2026 Draft'
  is_active  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enforces exactly ONE active season at the DB level.
-- A second UPDATE setting is_active = true raises a unique violation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_season
  ON public.seasons (is_active)
  WHERE is_active = true;

ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "seasons_public_read" ON public.seasons
  FOR SELECT USING (true);

CREATE POLICY "seasons_auth_write" ON public.seasons
  FOR ALL
  USING      (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Seed the current active season so the app has data on first launch
INSERT INTO public.seasons (title, is_active)
  VALUES ('April 2026 Draft', true)
ON CONFLICT DO NOTHING;


-- ── 3. SEASON PARTICIPANTS ───────────────────────────────────
-- One row per player per season. Deck colors live here, NOT on
-- players — preserves per-season color history across months.

CREATE TABLE IF NOT EXISTS public.season_participants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id   UUID NOT NULL REFERENCES public.seasons(id)  ON DELETE CASCADE,
  player_id   UUID NOT NULL REFERENCES public.players(id)  ON DELETE CASCADE,
  -- WUBRG codes: e.g. '{U,B}' for Blue/Black
  deck_colors TEXT[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_season_participant UNIQUE (season_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_sp_season_id ON public.season_participants (season_id);
CREATE INDEX IF NOT EXISTS idx_sp_player_id ON public.season_participants (player_id);

ALTER TABLE public.season_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sp_public_read" ON public.season_participants
  FOR SELECT USING (true);

CREATE POLICY "sp_auth_write" ON public.season_participants
  FOR ALL
  USING      (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Enroll all 6 players in the seeded April season automatically.
-- deck_colors starts empty — set them in-app or via Studio.
INSERT INTO public.season_participants (season_id, player_id)
  SELECT s.id, p.id
  FROM   public.seasons s
  CROSS  JOIN public.players p
  WHERE  s.title = 'April 2026 Draft'
ON CONFLICT (season_id, player_id) DO NOTHING;


-- ── 4. MATCHES ───────────────────────────────────────────────
-- Append-only event log. No win/loss columns — tallies are
-- computed dynamically. Delete a bad row to correct the record.

CREATE TABLE IF NOT EXISTS public.matches (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id  UUID NOT NULL REFERENCES public.seasons(id)  ON DELETE CASCADE,
  winner_id  UUID NOT NULL REFERENCES public.players(id)  ON DELETE RESTRICT,
  loser_id   UUID NOT NULL REFERENCES public.players(id)  ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Prevents reporting a player as both winner and loser
  CONSTRAINT chk_different_players CHECK (winner_id <> loser_id)
);

CREATE INDEX IF NOT EXISTS idx_matches_season_id ON public.matches (season_id);
CREATE INDEX IF NOT EXISTS idx_matches_winner_id ON public.matches (winner_id);
CREATE INDEX IF NOT EXISTS idx_matches_loser_id  ON public.matches (loser_id);

ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "matches_public_read" ON public.matches
  FOR SELECT USING (true);

-- Any authenticated user can insert (report) a match
CREATE POLICY "matches_auth_insert" ON public.matches
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Any authenticated user can delete a match to correct mistakes.
-- No UPDATE policy — corrections are delete + re-insert.
CREATE POLICY "matches_auth_delete" ON public.matches
  FOR DELETE USING (auth.role() = 'authenticated');


-- ── 5. LEADERBOARD RPC ───────────────────────────────────────
-- Called from the app as: supabase.rpc('get_active_leaderboard')
-- Returns all participants for the active season, sorted by wins.

CREATE OR REPLACE FUNCTION public.get_active_leaderboard()
  RETURNS TABLE (
    player_id   UUID,
    player_name TEXT,
    deck_colors TEXT[],
    wins        BIGINT,
    losses      BIGINT
  )
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = public
AS $$
  SELECT
    p.id                     AS player_id,
    p.name                   AS player_name,
    sp.deck_colors,
    COUNT(DISTINCT w.id)     AS wins,
    COUNT(DISTINCT l.id)     AS losses
  FROM public.season_participants sp
  JOIN public.seasons  s ON s.id = sp.season_id  AND s.is_active = true
  JOIN public.players  p ON p.id = sp.player_id
  LEFT JOIN public.matches w ON w.winner_id = p.id AND w.season_id = s.id
  LEFT JOIN public.matches l ON l.loser_id  = p.id AND l.season_id = s.id
  GROUP BY p.id, p.name, sp.deck_colors
  ORDER BY wins DESC, losses ASC;
$$;
