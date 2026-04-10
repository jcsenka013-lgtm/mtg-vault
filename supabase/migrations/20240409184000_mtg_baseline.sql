-- Create sessions table
CREATE TABLE IF NOT EXISTS public.sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  set_code    TEXT,
  cost_paid   NUMERIC NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create cards table
CREATE TABLE IF NOT EXISTS public.cards (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  scryfall_id       TEXT NOT NULL,
  name              TEXT NOT NULL,
  set_code          TEXT NOT NULL,
  set_name          TEXT NOT NULL,
  collector_number  TEXT NOT NULL,
  rarity            TEXT NOT NULL,
  colors            TEXT[] NOT NULL DEFAULT '{}',
  is_foil           BOOLEAN NOT NULL DEFAULT false,
  condition         TEXT NOT NULL DEFAULT 'NM',
  quantity          INTEGER NOT NULL DEFAULT 1,
  price_usd         NUMERIC,
  price_usd_foil    NUMERIC,
  price_fetched_at  TIMESTAMPTZ,
  image_uri         TEXT,
  scryfall_uri      TEXT,
  added_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;

-- Session Policies
CREATE POLICY "Users can manage their own sessions" ON public.sessions
  FOR ALL USING (auth.uid() = user_id);

-- Card Policies (Inferred from sessions)
CREATE POLICY "Users can manage cards in their sessions" ON public.cards
  FOR ALL USING (
    session_id IN (
      SELECT id FROM public.sessions WHERE user_id = auth.uid()
    )
  );
