-- Supabase database advisor hardening (security lints).
-- Residual: authenticated RPC on SECURITY DEFINER (e.g. ocr_admin_*) is intentional when gated inside the function;
--           enable leaked-password protection in Dashboard → Auth → Providers/Password (not SQL).

-- ── Mutable search_path: lock down public trigger/helpers ───────────────────
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('update_updated_at', 'get_auth_user_id', 'rls_auto_enable')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.fn);
  END LOOP;
END;
$$;

-- ── SECURITY DEFINER: not directly invokable via PostgREST (anon/authenticated) ─
-- Trigger-only / internal helpers — owner still runs triggers; revoke client RPC.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon, authenticated;

REVOKE ALL ON FUNCTION public._ocr_scan_events_participant_hash() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._ocr_scan_events_participant_hash() FROM anon, authenticated;

-- Optional legacy helper (not in repo migrations); safe to strip client access.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_auth_user_id', 'rls_auto_enable')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', r.fn);
  END LOOP;
END;
$$;

-- App RPC for signed-in users only; anon must not call SECURITY DEFINER public RPCs.
REVOKE EXECUTE ON FUNCTION public.is_ocr_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.ocr_admin_dashboard(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ocr_admin_random_sample(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ocr_admin_export_low_confidence(smallint, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ocr_admin_set_auto_accept_similarity_pct(smallint) FROM anon;

-- Split SELECT policies so anon policies never reference is_tournament_organizer (then revoke anon EXECUTE).
DROP POLICY IF EXISTS tournament_organizers_select ON public.tournament_organizers;
CREATE POLICY tournament_organizers_select_anon ON public.tournament_organizers FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE
        t.id = tournament_organizers.tournament_id
        AND t.visibility = 'public'
    )
  );
CREATE POLICY tournament_organizers_select_authenticated ON public.tournament_organizers FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE
        t.id = tournament_organizers.tournament_id
        AND (
          t.visibility = 'public'
          OR (
            (SELECT auth.uid()) IS NOT NULL
            AND (
              t.created_by = (SELECT auth.uid())
              OR public.is_tournament_organizer (t.id, (SELECT auth.uid()))
              OR (
                t.visibility = 'league'
                AND t.league_id IS NOT NULL
                AND EXISTS (
                  SELECT 1
                  FROM public.league_members lm
                  WHERE lm.league_id = t.league_id AND lm.user_id = (SELECT auth.uid())
                )
              )
              OR (
                t.visibility = 'private'
                AND (
                  t.created_by = (SELECT auth.uid())
                  OR public.is_tournament_organizer (t.id, (SELECT auth.uid()))
                )
              )
            )
          )
        )
    )
  );

DROP POLICY IF EXISTS tournaments_select ON public.tournaments;
CREATE POLICY tournaments_select_anon ON public.tournaments FOR SELECT TO anon
  USING (visibility = 'public');
CREATE POLICY tournaments_select_authenticated ON public.tournaments FOR SELECT TO authenticated
  USING (
    visibility = 'public'
    OR (
      (SELECT auth.uid()) IS NOT NULL
      AND (
        created_by = (SELECT auth.uid())
        OR public.is_tournament_organizer (id, (SELECT auth.uid()))
        OR (
          visibility = 'league'
          AND league_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.league_members lm
            WHERE lm.league_id = tournaments.league_id AND lm.user_id = (SELECT auth.uid())
          )
        )
        OR (
          visibility = 'private'
          AND (
            created_by = (SELECT auth.uid())
            OR public.is_tournament_organizer (id, (SELECT auth.uid()))
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS tournament_matches_select ON public.tournament_matches;
CREATE POLICY tournament_matches_select_anon ON public.tournament_matches FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE
        t.id = tournament_matches.tournament_id
        AND t.visibility = 'public'
    )
  );
CREATE POLICY tournament_matches_select_authenticated ON public.tournament_matches FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tournaments t
      WHERE
        t.id = tournament_matches.tournament_id
        AND (
          t.visibility = 'public'
          OR (
            (SELECT auth.uid()) IS NOT NULL
            AND (
              t.created_by = (SELECT auth.uid())
              OR public.is_tournament_organizer (t.id, (SELECT auth.uid()))
              OR (
                t.visibility = 'league'
                AND t.league_id IS NOT NULL
                AND EXISTS (
                  SELECT 1
                  FROM public.league_members lm
                  WHERE lm.league_id = t.league_id AND lm.user_id = (SELECT auth.uid())
                )
              )
              OR (
                t.visibility = 'private'
                AND (
                  t.created_by = (SELECT auth.uid())
                  OR public.is_tournament_organizer (t.id, (SELECT auth.uid()))
                )
              )
            )
          )
        )
    )
  );

REVOKE EXECUTE ON FUNCTION public.is_tournament_organizer(uuid, uuid) FROM anon;

-- Re-assert authenticated execute (idempotent) after any environment drift.
GRANT EXECUTE ON FUNCTION public.is_ocr_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ocr_admin_dashboard(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ocr_admin_random_sample(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ocr_admin_export_low_confidence(smallint, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ocr_admin_set_auto_accept_similarity_pct(smallint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_tournament_organizer(uuid, uuid) TO authenticated;

-- ── RLS: players INSERT was WITH CHECK (true) for any authenticated client ──
-- New rows come from SECURITY DEFINER trigger on auth.users (owner bypasses RLS).
DROP POLICY IF EXISTS "players_insert_trigger" ON public.players;

-- ── RLS: contact form — replace literal WITH CHECK (true) with field checks ──
DO $$
BEGIN
  IF to_regclass('public.contact_submissions') IS NULL THEN
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "Allow anonymous inserts" ON public.contact_submissions;
  DROP POLICY IF EXISTS contact_submissions_public_insert ON public.contact_submissions;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'contact_submissions'
      AND policyname = 'contact_submissions_insert_valid_payload'
  ) THEN
    CREATE POLICY contact_submissions_insert_valid_payload
      ON public.contact_submissions
      FOR INSERT
      TO anon, authenticated
      WITH CHECK (
        length(trim(coalesce(name, ''))) >= 1
        AND length(trim(coalesce(email, ''))) >= 3
        AND length(trim(coalesce(message, ''))) >= 1
      );
  END IF;
END;
$$;
