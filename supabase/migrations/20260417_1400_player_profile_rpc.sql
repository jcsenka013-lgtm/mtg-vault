-- ============================================================
-- Player Profile RPC - Advanced Data Layer (BUGFIX VERSION)
-- MTG Vault — April 2026
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_player_profile(p_id UUID)
  RETURNS TABLE (
    player_id      UUID,
    player_name    TEXT,
    lifetime_wins  BIGINT,
    lifetime_losses BIGINT,
    win_percentage NUMERIC(5,2),
    favorite_colors TEXT[],
    rivalry_matrix JSONB,
    nemesis_name   TEXT,
    nemesis_losses BIGINT,
    victim_name    TEXT,
    victim_wins    BIGINT
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY INVOKER
  SET search_path = public
AS $$
DECLARE
  total_wins      BIGINT;
  total_losses    BIGINT;
  pct            NUMERIC(5,2);
  fav_colors     TEXT[];
  r_matrix       JSONB;
  n_name         TEXT;
  n_losses_val   BIGINT;
  v_name         TEXT;
  v_wins_val     BIGINT;
BEGIN
  -- Lifetime Record
  SELECT
    COUNT(*) FILTER (WHERE winner_id = p_id),
    COUNT(*) FILTER (WHERE loser_id = p_id)
  INTO total_wins, total_losses
  FROM public.matches;

  IF total_wins + total_losses > 0 THEN
    pct := ROUND((total_wins::NUMERIC / (total_wins + total_losses)) * 100, 2);
  ELSE
    pct := 0;
  END IF;

  -- Favorite Colors: Qualified with 'sp' alias to prevent ambiguity
  WITH color_flat AS (
    SELECT unnest(sp.deck_colors) AS color
    FROM public.season_participants sp
    WHERE sp.player_id = p_id
      AND array_length(sp.deck_colors, 1) > 0
  )
  SELECT array_agg(color ORDER BY cnt DESC)
  INTO fav_colors
  FROM (
    SELECT color, COUNT(*) AS cnt
    FROM color_flat
    GROUP BY color
    ORDER BY cnt DESC
    LIMIT 3
  ) AS top_colors;

  -- Rivalry Matrix
  SELECT jsonb_agg(jsonb_build_object(
    'opponent_id', opp.id,
    'opponent_name', opp.name,
    'wins_against', COALESCE(w.wins, 0),
    'losses_against', COALESCE(l.losses, 0)
  ) ORDER BY opp.name)
  INTO r_matrix
  FROM public.players opp
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS wins
    FROM public.matches m
    WHERE m.winner_id = p_id AND m.loser_id = opp.id
  ) w ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS losses
    FROM public.matches m
    WHERE m.loser_id = p_id AND m.winner_id = opp.id
  ) l ON true
  WHERE opp.id <> p_id;

  -- Nemesis
  SELECT opp.name, COUNT(*)::BIGINT
  INTO n_name, n_losses_val
  FROM public.matches m
  JOIN public.players opp ON opp.id = m.winner_id
  WHERE m.loser_id = p_id
  GROUP BY opp.id, opp.name
  ORDER BY COUNT(*) DESC
  LIMIT 1;

  -- Favorite Victim
  SELECT opp.name, COUNT(*)::BIGINT
  INTO v_name, v_wins_val
  FROM public.matches m
  JOIN public.players opp ON opp.id = m.loser_id
  WHERE m.winner_id = p_id
  GROUP BY opp.id, opp.name
  ORDER BY COUNT(*) DESC
  LIMIT 1;

  -- Use explicit qualification in the return
  RETURN QUERY SELECT
    p_id,
    p.name,
    total_wins,
    total_losses,
    pct,
    COALESCE(fav_colors, '{}'),
    COALESCE(r_matrix, '[]'::JSONB),
    COALESCE(n_name, 'None'),
    COALESCE(n_losses_val, 0),
    COALESCE(v_name, 'None'),
    COALESCE(v_wins_val, 0)
  FROM public.players p
  WHERE p.id = p_id;
END;
$$;

-- Lifetime Leaderboard RPC
CREATE OR REPLACE FUNCTION public.get_lifetime_leaderboard()
  RETURNS TABLE (
    player_id   UUID,
    player_name TEXT,
    lifetime_wins BIGINT,
    lifetime_losses BIGINT,
    win_percentage NUMERIC(5,2)
  )
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = public
AS $$
  SELECT
    p.id               AS player_id,
    p.name             AS player_name,
    COUNT(*) FILTER (WHERE m.winner_id = p.id)::BIGINT AS lifetime_wins,
    COUNT(*) FILTER (WHERE m.loser_id = p.id)::BIGINT AS lifetime_losses,
    CASE 
      WHEN COUNT(*) > 0 THEN ROUND((COUNT(*) FILTER (WHERE m.winner_id = p.id))::NUMERIC / COUNT(*) * 100, 2)
      ELSE 0::NUMERIC(5,2)
    END AS win_percentage
  FROM public.players p
  LEFT JOIN public.matches m ON m.winner_id = p.id OR m.loser_id = p.id
  GROUP BY p.id, p.name
  ORDER BY lifetime_wins DESC, lifetime_losses ASC;
$$;