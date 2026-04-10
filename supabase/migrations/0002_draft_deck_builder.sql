-- Create Decks table
CREATE TABLE IF NOT EXISTS decks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users NOT NULL,
  name TEXT NOT NULL,
  format TEXT CHECK (format IN ('Draft', 'Standard', 'Modern', 'Commander', 'Pioneer', 'Legacy', 'Vintage')) DEFAULT 'Draft',
  event_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create Deck Cards junction table
CREATE TABLE IF NOT EXISTS deck_cards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  deck_id UUID REFERENCES decks NOT NULL,
  card_id UUID REFERENCES cards NOT NULL,
  quantity INTEGER DEFAULT 1 CHECK (quantity > 0),
  zone TEXT CHECK (zone IN ('mainboard', 'sideboard', 'commander')) DEFAULT 'mainboard',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_decks_user_id ON decks (user_id);
CREATE INDEX IF NOT EXISTS idx_deck_cards_deck_id ON deck_cards (deck_id);
CREATE INDEX IF NOT EXISTS idx_deck_cards_card_id ON deck_cards (card_id);

-- Row Level Security (RLS) policies
ALTER TABLE decks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own decks" ON decks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own decks" ON decks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own decks" ON decks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own decks" ON decks FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE deck_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view deck cards" ON deck_cards FOR SELECT USING (
  deck_id IN (SELECT id FROM decks WHERE auth.uid() = user_id)
);
CREATE POLICY "Users can insert deck cards" ON deck_cards FOR INSERT WITH CHECK (
  deck_id IN (SELECT id FROM decks WHERE auth.uid() = user_id)
);
CREATE POLICY "Users can update deck cards" ON deck_cards FOR UPDATE USING (
  deck_id IN (SELECT id FROM decks WHERE auth.uid() = user_id)
);
CREATE POLICY "Users can delete deck cards" ON deck_cards FOR DELETE USING (
  deck_id IN (SELECT id FROM decks WHERE auth.uid() = user_id)
);

-- Set up updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
  RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
BEGIN
  CREATE TRIGGER  decks_updated_at BEFORE UPDATE ON decks FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
  CREATE TRIGGER  deck_cards_updated_at BEFORE UPDATE ON deck_cards FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END;
$$;