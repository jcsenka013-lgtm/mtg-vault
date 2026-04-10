-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260410_1200_deck_cards_standalone
-- Purpose:   Decouple deck_cards from the local `cards` inventory table so
--            users can add any Scryfall card to a deck (not just ones they
--            have physically scanned). Stores card metadata directly.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Drop the FK constraint and old card_id UUID column
--    (If there are existing rows we want to preserve them — we NULL the column
--     first to avoid FK violations, then drop the constraint.)
ALTER TABLE public.deck_cards
  DROP CONSTRAINT IF EXISTS deck_cards_card_id_fkey;

-- 2. Change card_id to TEXT so it stores a Scryfall card ID string
--    (safe because we already dropped the FK constraint above)
ALTER TABLE public.deck_cards
  ALTER COLUMN card_id DROP NOT NULL;

-- Convert UUID column to TEXT (requires recreate since Postgres doesn't
-- allow direct UUID → TEXT cast via ALTER COLUMN)
ALTER TABLE public.deck_cards
  ADD COLUMN IF NOT EXISTS card_id_text TEXT;

-- Copy existing data
UPDATE public.deck_cards SET card_id_text = card_id::text WHERE card_id IS NOT NULL;

-- Drop old UUID column
ALTER TABLE public.deck_cards DROP COLUMN IF EXISTS card_id;

-- Rename new column
ALTER TABLE public.deck_cards RENAME COLUMN card_id_text TO card_id;

-- Add NOT NULL constraint now that data is migrated
ALTER TABLE public.deck_cards ALTER COLUMN card_id SET NOT NULL;

-- 3. Add stored card metadata columns so we don't need a join to display cards
ALTER TABLE public.deck_cards
  ADD COLUMN IF NOT EXISTS name       TEXT,
  ADD COLUMN IF NOT EXISTS mana_cost  TEXT,
  ADD COLUMN IF NOT EXISTS type_line  TEXT,
  ADD COLUMN IF NOT EXISTS rarity     TEXT DEFAULT 'common',
  ADD COLUMN IF NOT EXISTS image_uri  TEXT;

-- 4. Index for fast deck lookups
CREATE INDEX IF NOT EXISTS idx_deck_cards_card_id_text ON public.deck_cards(card_id);

-- 5. Re-add sensible unique constraint: one row per card per zone per deck
ALTER TABLE public.deck_cards
  DROP CONSTRAINT IF EXISTS deck_cards_unique_card_zone;

ALTER TABLE public.deck_cards
  ADD CONSTRAINT deck_cards_unique_card_zone UNIQUE (deck_id, card_id, zone);
