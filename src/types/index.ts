// Scryfall API Types

export interface ScryfallCard {
  id: string;
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  rarity: "common" | "uncommon" | "rare" | "mythic" | "special" | "bonus";
  colors: string[] | null;
  color_identity: string[];
  type_line: string;
  oracle_text?: string;
  mana_cost?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  image_uris?: {
    small: string;
    normal: string;
    large: string;
    art_crop: string;
  };
  card_faces?: Array<{
    name: string;
    image_uris?: {
      small: string;
      normal: string;
      large: string;
      art_crop: string;
    };
  }>;
  prices: {
    usd: string | null;
    usd_foil: string | null;
    usd_etched: string | null;
    eur: string | null;
    eur_foil: string | null;
  };
  scryfall_uri: string;
  purchase_uris?: {
    tcgplayer?: string;
    cardmarket?: string;
    cardhoarder?: string;
  };
  full_art?: boolean;
  border_color?: string;
  promo_types?: string[];
}

export interface ScryfallSearchResponse {
  object: "list";
  total_cards: number;
  has_more: boolean;
  data: ScryfallCard[];
}

export interface ScryfallAutocompleteResponse {
  object: "catalog";
  total_values: number;
  data: string[];
}

// App-level card type (what gets stored and displayed in UI)
export interface ScannedCard {
  id: string;
  sessionId: string;
  scryfallId: string;
  name: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  rarity: "common" | "uncommon" | "rare" | "mythic";
  colors: string[];
  isFoil: boolean;
  condition: "NM" | "LP" | "MP" | "HP" | "DMG";
  quantity: number;
  priceUsd: number | null;
  priceUsdFoil: number | null;
  priceFetchedAt: number | null;
  imageUri: string | null;
  scryfallUri: string | null;
  addedAt: number;
  destination?: "LGS" | "BULK" | null;
}

// ROI / Dashboard types
export interface SessionROI {
  costPaid: number;
  totalCards: number;
  totalValue: number;
  profitLoss: number;
  profitPercent: number;
  byRarity: {
    mythic: { count: number; value: number };
    rare: { count: number; value: number };
    uncommon: { count: number; value: number };
    common: { count: number; value: number };
  };
  topCards: ScannedCard[];
}

// Sort/filter options
export type SortField = "name" | "value" | "rarity" | "set" | "addedAt";
export type SortOrder = "asc" | "desc";
export type RarityFilter = "all" | "mythic" | "rare" | "uncommon" | "common";
export type FoilFilter = "all" | "foil" | "nonfoil";
