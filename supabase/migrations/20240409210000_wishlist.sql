-- Create wishlist table
CREATE TABLE IF NOT EXISTS public.wishlist (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id     UUID REFERENCES public.cards(id) ON DELETE SET NULL,
  scryfall_id TEXT,
  name        TEXT NOT NULL,
  set_code    TEXT,
  set_name    TEXT,
  collector_number TEXT,
  rarity      TEXT,
  price_target NUMERIC,
  is_foil     BOOLEAN NOT NULL DEFAULT false,
  condition   TEXT NOT NULL DEFAULT 'NM',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.wishlist ENABLE ROW LEVEL SECURITY;

-- Wishlist Policies
CREATE POLICY "Users can manage their own wishlist items" ON public.wishlist
  FOR ALL USING (auth.uid() = user_id);

-- Allow users to view their own wishlist items
CREATE POLICY "Users can view their own wishlist items" ON public.wishlist
  FOR SELECT USING (auth.uid() = user_id);