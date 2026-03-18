import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Anonymous shared-pool model — no individual auth required
    autoRefreshToken: false,
    persistSession: false,
  },
});

// TypeScript types matching our Supabase schema
export interface DbSession {
  id: string;
  name: string;
  set_code: string | null;
  cost_paid: number;
  created_at: string;
  updated_at: string;
}

export interface DbCard {
  id: string;
  session_id: string;
  scryfall_id: string;
  name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  rarity: "common" | "uncommon" | "rare" | "mythic";
  colors: string[];
  is_foil: boolean;
  condition: "NM" | "LP" | "MP" | "HP" | "DMG";
  quantity: number;
  price_usd: number | null;
  price_usd_foil: number | null;
  price_fetched_at: string | null;
  image_uri: string | null;
  scryfall_uri: string | null;
  added_at: string;
}
