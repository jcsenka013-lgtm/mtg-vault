-- Add destination column to cards table
-- 'LGS' for local game store credit/trade
-- 'BULK' for bulk processing/eBay auto-listing
ALTER TABLE public.cards ADD COLUMN destination TEXT CHECK (destination IN ('LGS', 'BULK'));
