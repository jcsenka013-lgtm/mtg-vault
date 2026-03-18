import axios from "axios";
import type {
  ScryfallCard,
  ScryfallSearchResponse,
  ScryfallAutocompleteResponse,
} from "@mtgtypes/index";

const SCRYFALL_BASE = "https://api.scryfall.com";

const scryfallClient = axios.create({
  baseURL: SCRYFALL_BASE,
  headers: {
    "User-Agent": "MTGScanner/1.0 (contact@mtgscanner.app)",
    Accept: "application/json",
  },
  timeout: 10000,
});

// Rate-limit helper: Scryfall asks for max 10 req/s
let lastRequestTime = 0;
const MIN_REQUEST_GAP_MS = 100;

async function rateLimitedGet<T>(url: string, params?: Record<string, string>): Promise<T> {
  const now = Date.now();
  const gap = now - lastRequestTime;
  if (gap < MIN_REQUEST_GAP_MS) {
    await new Promise((r) => setTimeout(r, MIN_REQUEST_GAP_MS - gap));
  }
  lastRequestTime = Date.now();
  const response = await scryfallClient.get<T>(url, { params });
  return response.data;
}

/**
 * Fuzzy card search by name (best for OCR output).
 * Returns top candidates sorted by relevance.
 */
export async function searchCardByName(name: string): Promise<ScryfallCard[]> {
  try {
    // First try fuzzy exact match
    const card = await rateLimitedGet<ScryfallCard>("/cards/named", {
      fuzzy: name,
    });
    return [card];
  } catch {
    // Fall back to full search for multiple candidates
    try {
      const result = await rateLimitedGet<ScryfallSearchResponse>("/cards/search", {
        q: name,
        order: "name",
        unique: "prints",
      });
      return result.data.slice(0, 5);
    } catch {
      return [];
    }
  }
}

/**
 * Get a card by exact set code and collector number.
 * Most precise lookup — used when OCR reads the collector number.
 */
export async function getCardBySetAndNumber(
  setCode: string,
  collectorNumber: string
): Promise<ScryfallCard | null> {
  try {
    return await rateLimitedGet<ScryfallCard>(`/cards/${setCode.toLowerCase()}/${collectorNumber}`);
  } catch {
    return null;
  }
}

/**
 * Autocomplete card names (for manual search input).
 */
export async function autocompleteCardName(partial: string): Promise<string[]> {
  if (partial.length < 2) return [];
  try {
    const result = await rateLimitedGet<ScryfallAutocompleteResponse>("/cards/autocomplete", {
      q: partial,
    });
    return result.data.slice(0, 8);
  } catch {
    return [];
  }
}

/**
 * Refresh price data for a known Scryfall card ID.
 */
export async function refreshCardPrice(
  scryfallId: string
): Promise<{ usd: number | null; usdFoil: number | null } | null> {
  try {
    const card = await rateLimitedGet<ScryfallCard>(`/cards/${scryfallId}`);
    return {
      usd: card.prices.usd ? parseFloat(card.prices.usd) : null,
      usdFoil: card.prices.usd_foil ? parseFloat(card.prices.usd_foil) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Extract the best available image URI from a Scryfall card object.
 */
export function extractImageUri(card: ScryfallCard): string | null {
  if (card.image_uris?.normal) return card.image_uris.normal;
  if (card.card_faces?.[0]?.image_uris?.normal) return card.card_faces[0].image_uris.normal;
  return null;
}

/**
 * Parse a ScryfallCard into our app's normalized format.
 */
export function normalizeScryfallCard(card: ScryfallCard) {
  return {
    scryfallId: card.id,
    name: card.name,
    setCode: card.set,
    setName: card.set_name,
    collectorNumber: card.collector_number,
    rarity: (["common","uncommon","rare","mythic"].includes(card.rarity) ? card.rarity : "common") as
      "common" | "uncommon" | "rare" | "mythic",
    colors: card.colors ?? [],
    priceUsd: card.prices.usd ? parseFloat(card.prices.usd) : null,
    priceUsdFoil: card.prices.usd_foil ? parseFloat(card.prices.usd_foil) : null,
    imageUri: extractImageUri(card),
    scryfallUri: card.scryfall_uri,
  };
}
