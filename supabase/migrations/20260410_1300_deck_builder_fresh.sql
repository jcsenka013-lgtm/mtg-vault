-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260410_1300_deck_builder_fresh
-- Purpose:   Create decks + deck_cards tables from scratch.
--            deck_cards stores Scryfall metadata inline so any card can be
--            added to a deck — not just cards in the local inventory.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Decks table
CREATE TABLE IF NOT EXISTS public.decks (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES auth.users NOT NULL,
  name        TEXT NOT NULL,
  format      TEXT CHECK (format IN ('Draft','Standard','Modern','Commander','Pioneer','Legacy','Vintage'))
              DEFAULT 'Draft',
  card_count  INTEGER DEFAULT 0,
  event_date  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Deck Cards table — stores card metadata inline (no FK to inventory)
CREATE TABLE IF NOT EXISTS public.deck_cards (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  deck_id     UUID REFERENCES public.decks(id) ON DELETE CASCADE NOT NULL,
  card_id     TEXT NOT NULL,          -- Scryfall card ID (string)
  name        TEXT,                   -- Card name (cached for display)
  mana_cost   TEXT,                   -- e.g. "{2}{U}{B}"
  type_line   TEXT,
  rarity      TEXT DEFAULT 'common',
  image_uri   TEXT,
  quantity    INTEGER DEFAULT 1 CHECK (quantity > 0),
  zone        TEXT CHECK (zone IN ('mainboard','sideboard','commander')) DEFAULT 'mainboard',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT deck_cards_unique_card_zone UNIQUE (deck_id, card_id, zone)
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_decks_user_id        ON public.decks(user_id);
CREATE INDEX IF NOT EXISTS idx_deck_cards_deck_id   ON public.deck_cards(deck_id);
CREATE INDEX IF NOT EXISTS idx_deck_cards_card_id   ON public.deck_cards(card_id);

-- 4. RLS on decks
ALTER TABLE public.decks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own decks"   ON public.decks;
DROP POLICY IF EXISTS "Users can insert own decks" ON public.decks;
DROP POLICY IF EXISTS "Users can update own decks" ON public.decks;
DROP POLICY IF EXISTS "Users can delete own decks" ON public.decks;

CREATE POLICY "Users can view own decks"
  ON public.decks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own decks"
  ON public.decks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own decks"
  ON public.decks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own decks"
  ON public.decks FOR DELETE USING (auth.uid() = user_id);

-- 5. RLS on deck_cards (scoped through decks ownership)
ALTER TABLE public.deck_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view deck cards"   ON public.deck_cards;
DROP POLICY IF EXISTS "Users can insert deck cards" ON public.deck_cards;
DROP POLICY IF EXISTS "Users can update deck cards" ON public.deck_cards;
DROP POLICY IF EXISTS "Users can delete deck cards" ON public.deck_cards;

CREATE POLICY "Users can view deck cards"
  ON public.deck_cards FOR SELECT
  USING (deck_id IN (SELECT id FROM public.decks WHERE auth.uid() = user_id));
CREATE POLICY "Users can insert deck cards"
  ON public.deck_cards FOR INSERT
  WITH CHECK (deck_id IN (SELECT id FROM public.decks WHERE auth.uid() = user_id));
CREATE POLICY "Users can update deck cards"
  ON public.deck_cards FOR UPDATE
  USING (deck_id IN (SELECT id FROM public.decks WHERE auth.uid() = user_id));
CREATE POLICY "Users can delete deck cards"
  ON public.deck_cards FOR DELETE
  USING (deck_id IN (SELECT id FROM public.decks WHERE auth.uid() = user_id));

-- 6. auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER decks_updated_at
    BEFORE UPDATE ON public.decks
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER deck_cards_updated_at
    BEFORE UPDATE ON public.deck_cards
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
