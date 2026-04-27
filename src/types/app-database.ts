import type { Database as GeneratedDatabase } from "./database";

type Gen = GeneratedDatabase["public"];
type GenTables = Gen["Tables"];
type GenFunctions = Gen["Functions"];

/** Columns used by the app that may exist in Postgres before `supabase gen types` reflects them. */
type CardAppColumns = {
  destination?: string | null;
  cmc?: number | null;
  mana_cost?: string | null;
  type_line?: string | null;
  oracle_text?: string | null;
  power?: string | null;
  toughness?: string | null;
  loyalty?: string | null;
  scan_confidence?: number | null;
  scan_ocr_engine?: string | null;
  scan_image_match_rank?: number | null;
  scan_ocr_unverified?: boolean | null;
  language?: string | null;
};

type MergedTables = Omit<GenTables, "cards" | "tournaments"> & {
  cards: {
    Row: GenTables["cards"]["Row"] & CardAppColumns;
    Insert: GenTables["cards"]["Insert"] & Partial<CardAppColumns>;
    Update: GenTables["cards"]["Update"] & Partial<CardAppColumns>;
    Relationships: GenTables["cards"]["Relationships"];
  };
  tournaments: {
    Row: GenTables["tournaments"]["Row"] & {
      tournament_seed?: string | null;
      created_by?: string;
      visibility?: string;
      league_id?: string | null;
    };
    Insert: Omit<GenTables["tournaments"]["Insert"], "started_at"> & {
      started_at?: string;
      tournament_seed?: string | null;
      created_by?: string;
      visibility?: string;
      league_id?: string | null;
    };
    Update: GenTables["tournaments"]["Update"] & {
      tournament_seed?: string | null;
      created_by?: string;
      visibility?: string;
      league_id?: string | null;
    };
    Relationships: GenTables["tournaments"] extends { Relationships: infer R } ? R : never;
  };
} & {
  tournament_organizers: {
    Row: { tournament_id: string; user_id: string };
    Insert: { tournament_id: string; user_id: string };
    Update: { tournament_id?: string; user_id?: string };
    Relationships: [];
  };
  league_members: {
    Row: { league_id: string; user_id: string; role: string };
    Insert: { league_id: string; user_id: string; role: string };
    Update: { league_id?: string; user_id?: string; role?: string };
    Relationships: [];
  };
} & {
  wishlist: {
    Row: {
      id: string;
      user_id: string;
      card_id: string | null;
      scryfall_id: string | null;
      name: string;
      set_code: string | null;
      set_name: string | null;
      collector_number: string | null;
      rarity: string | null;
      price_target: number | null;
      is_foil: boolean;
      condition: string;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      id?: string;
      user_id: string;
      card_id?: string | null;
      scryfall_id?: string | null;
      name: string;
      set_code?: string | null;
      set_name?: string | null;
      collector_number?: string | null;
      rarity?: string | null;
      price_target?: number | null;
      is_foil?: boolean;
      condition?: string;
      created_at?: string;
      updated_at?: string;
    };
    Update: {
      id?: string;
      user_id?: string;
      card_id?: string | null;
      scryfall_id?: string | null;
      name?: string;
      set_code?: string | null;
      set_name?: string | null;
      collector_number?: string | null;
      rarity?: string | null;
      price_target?: number | null;
      is_foil?: boolean;
      condition?: string;
      created_at?: string;
      updated_at?: string;
    };
    Relationships: [];
  };
  ebay_tokens: {
    Row: {
      id: string;
      user_id: string;
      access_token: string;
      refresh_token: string;
      expires_at: string;
      token_type: string;
      scope: string;
      created_at: string | null;
      updated_at: string | null;
    };
    Insert: {
      id?: string;
      user_id: string;
      access_token: string;
      refresh_token: string;
      expires_at: string;
      token_type: string;
      scope: string;
      created_at?: string | null;
      updated_at?: string | null;
    };
    Update: {
      id?: string;
      user_id?: string;
      access_token?: string;
      refresh_token?: string;
      expires_at?: string;
      token_type?: string;
      scope?: string;
      created_at?: string | null;
      updated_at?: string | null;
    };
    Relationships: [];
  };
};

type MergedFunctions = GenFunctions & {
  save_deck: {
    Args: {
      userId: string;
      name: string;
      format: string;
      eventDate: string;
      cards: { card_id: string; quantity: number; zone: string }[];
    };
    Returns: unknown;
  };
};

/**
 * Supabase client schema: generated `Database` plus tables/RPCs from repo migrations
 * not yet present on the linked project (or omitted from introspection).
 * Regenerate `database.ts` with `npm run db:types`; trim this file when the host matches.
 */
export type AppDatabase = Omit<GeneratedDatabase, "public"> & {
  public: Omit<Gen, "Tables" | "Functions"> & {
    Tables: MergedTables;
    Functions: MergedFunctions;
  };
};

export type AppTables<T extends keyof AppDatabase["public"]["Tables"]> =
  AppDatabase["public"]["Tables"][T] extends { Row: infer R } ? R : never;

export type AppTablesUpdate<T extends keyof AppDatabase["public"]["Tables"]> =
  AppDatabase["public"]["Tables"][T] extends { Update: infer U } ? U : never;
