import { supabase } from "@/lib/supabase";
import type { DbSession, DbCard, Tables } from "@/lib/supabase";
import type { Json } from "@/types/database";
import type { AppTablesUpdate } from "@/types/app-database";
import type { SessionROI, ScannedCard } from "@mtgtypes/index";

// ─── Sessions ────────────────────────────────────────────────────────────────

export async function createSession(data: {
  name: string;
  setCode?: string | null;
  costPaid?: number;
}): Promise<DbSession> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Authenticated user required to create a session");

  const { data: result, error } = await supabase
    .from("sessions")
    .insert({
      user_id: user.id,
      name: data.name,
      set_code: data.setCode ?? null,
      cost_paid: data.costPaid ?? 0,
    })
    .select()
    .single();
  if (error) throw error;
  return result;
}

export async function getOrCreateIndividualSession(): Promise<DbSession> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Authenticated user required");

  // Look for a session named "Individual Entries"
  const { data: existing, error: searchError } = await supabase
    .from("sessions")
    .select("*")
    .eq("user_id", user.id)
    .eq("name", "Individual Entries")
    .maybeSingle();

  if (existing) return existing;

  // Create it if not exists
  const { data: result, error: createError } = await supabase
    .from("sessions")
    .insert({
      user_id: user.id,
      name: "Individual Entries",
      cost_paid: 0,
    })
    .select()
    .single();

  if (createError) throw createError;
  return result;
}

export async function getAllSessions(): Promise<DbSession[]> {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getSession(id: string): Promise<DbSession | undefined> {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", id)
    .single();
  if (error && error.code !== "PGRST116") throw error;
  return data ?? undefined;
}

export async function updateSessionCost(id: string, costPaid: number): Promise<void> {
  const { error } = await supabase
    .from("sessions")
    .update({ cost_paid: costPaid })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteSession(id: string): Promise<void> {
  const { error } = await supabase.from("sessions").delete().eq("id", id);
  if (error) throw error;
}

// ─── Cards ───────────────────────────────────────────────────────────────────

export async function addCard(data: {
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
  quantity?: number;
  priceUsd: number | null;
  priceUsdFoil: number | null;
  imageUri: string | null;
  scryfallUri: string | null;
  destination?: "LGS" | "BULK";
  scanConfidence?: number | null;
  scanOcrEngine?: string | null;
  scanImageMatchRank?: number | null;
  scanOcrUnverified?: boolean;
  language?: string | null;
}): Promise<DbCard> {
  const { data: result, error } = await supabase
    .from("cards")
    .insert({
      session_id: data.sessionId,
      scryfall_id: data.scryfallId,
      name: data.name,
      set_code: data.setCode,
      set_name: data.setName,
      collector_number: data.collectorNumber,
      rarity: data.rarity,
      colors: data.colors,
      is_foil: data.isFoil,
      condition: data.condition,
      quantity: data.quantity ?? 1,
      price_usd: data.priceUsd,
      price_usd_foil: data.priceUsdFoil,
      price_fetched_at: new Date().toISOString(),
      image_uri: data.imageUri,
      scryfall_uri: data.scryfallUri,
      destination: data.destination,
      scan_confidence: data.scanConfidence ?? null,
      scan_ocr_engine: data.scanOcrEngine ?? null,
      scan_image_match_rank: data.scanImageMatchRank ?? null,
      scan_ocr_unverified: data.scanOcrUnverified ?? false,
      language: data.language ?? "en",
    })
    .select()
    .single();
  if (error) throw error;
  return result;
}

export async function bulkAddCards(cards: Array<{
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
  quantity?: number;
  priceUsd: number | null;
  priceUsdFoil: number | null;
  imageUri: string | null;
  scryfallUri: string | null;
  destination?: "LGS" | "BULK";
}>): Promise<void> {
  if (cards.length === 0) return;
  const rows = cards.map((data) => ({
    session_id: data.sessionId,
    scryfall_id: data.scryfallId,
    name: data.name,
    set_code: data.setCode,
    set_name: data.setName,
    collector_number: data.collectorNumber,
    rarity: data.rarity,
    colors: data.colors,
    is_foil: data.isFoil,
    condition: data.condition,
    quantity: data.quantity ?? 1,
    price_usd: data.priceUsd,
    price_usd_foil: data.priceUsdFoil,
    price_fetched_at: new Date().toISOString(),
    image_uri: data.imageUri,
    scryfall_uri: data.scryfallUri,
    destination: data.destination,
  }));
  const { error } = await supabase.from("cards").insert(rows);
  if (error) throw error;
}

export async function getCardsForSession(
  sessionId: string,
  opts?: {
    rarity?: string;
    isFoil?: boolean;
    search?: string;
    sortField?: string;
    sortOrder?: "asc" | "desc";
  }
): Promise<DbCard[]> {
  let query = supabase.from("cards").select("*").eq("session_id", sessionId);

  if (opts?.rarity && opts.rarity !== "all") {
    query = query.eq("rarity", opts.rarity);
  }
  if (opts?.isFoil !== undefined) {
    query = query.eq("is_foil", opts.isFoil);
  }
  if (opts?.search?.trim()) {
    query = query.ilike("name", `%${opts.search.trim()}%`);
  }

  const sortMap: Record<string, string> = {
    addedAt: "added_at",
    priceUsd: "price_usd",
  };
  const rawField = opts?.sortField ?? "added_at";
  const field = sortMap[rawField] || rawField;

  const ascending = (opts?.sortOrder ?? "desc") === "asc";
  query = query.order(field, { ascending });

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getAllCards(): Promise<DbCard[]> {
  const { data, error } = await supabase
    .from("cards")
    .select("*")
    .order("added_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function updateCardFoil(id: string, isFoil: boolean): Promise<void> {
  const { error } = await supabase.from("cards").update({ is_foil: isFoil }).eq("id", id);
  if (error) throw error;
}

export async function updateCardCondition(id: string, condition: string): Promise<void> {
  const { error } = await supabase.from("cards").update({ condition }).eq("id", id);
  if (error) throw error;
}

export async function updateCardPrices(
  id: string,
  priceUsd: number | null,
  priceUsdFoil: number | null
): Promise<void> {
  const { error } = await supabase
    .from("cards")
    .update({ price_usd: priceUsd, price_usd_foil: priceUsdFoil, price_fetched_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteCard(id: string): Promise<void> {
  const { data, error } = await supabase
    .from("cards")
    .delete()
    .eq("id", id)
    .select();
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("Card not found or permission denied");
  }
}

// ─── Wishlist ────────────────────────────────────────────────────────────────

export async function getWishlistItems(): Promise<Tables<"wishlist">[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Authenticated user required");

  const { data, error } = await supabase
    .from("wishlist")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addWishlistItem(data: {
  cardId?: string;
  scryfallId: string;
  name: string;
  setCode?: string;
  setName?: string;
  collectorNumber?: string;
  rarity?: string;
  priceTarget?: number;
  isFoil?: boolean;
  condition?: string;
}): Promise<Tables<"wishlist">> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Authenticated user required");

  const { data: result, error } = await supabase
    .from("wishlist")
    .insert({
      user_id: user.id,
      card_id: data.cardId ?? null,
      scryfall_id: data.scryfallId,
      name: data.name,
      set_code: data.setCode ?? null,
      set_name: data.setName ?? null,
      collector_number: data.collectorNumber ?? null,
      rarity: data.rarity ?? null,
      price_target: data.priceTarget ?? null,
      is_foil: data.isFoil ?? false,
      condition: data.condition ?? "NM",
    })
    .select()
    .single();
  if (error) throw error;
  return result;
}

export async function removeWishlistItem(id: string): Promise<void> {
  const { error, count } = await supabase.from("wishlist").delete({ count: "exact" }).eq("id", id);
  if (error) throw error;
  if (count === 0) {
    throw new Error("Wishlist item not found or permission denied");
  }
}

export async function updateWishlistItem(id: string, updates: {
  priceTarget?: number | null;
  isFoil?: boolean;
  condition?: string;
}): Promise<void> {
  const payload: AppTablesUpdate<"wishlist"> = { updated_at: new Date().toISOString() };
  if (updates.priceTarget !== undefined) payload.price_target = updates.priceTarget;
  if (updates.isFoil !== undefined) payload.is_foil = updates.isFoil;
  if (updates.condition !== undefined) payload.condition = updates.condition;
  const { error } = await supabase.from("wishlist").update(payload).eq("id", id);
  if (error) throw error;
}

export async function getWishlistItem(id: string): Promise<Tables<"wishlist"> | undefined> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Authenticated user required");

  const { data, error } = await supabase
    .from("wishlist")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data ?? undefined;
}

// ─── ROI Calculation ─────────────────────────────────────────────────────────

export async function calculateSessionROI(sessionId: string): Promise<SessionROI> {
  const [session, allCards] = await Promise.all([
    getSession(sessionId),
    getCardsForSession(sessionId),
  ]);

  const byRarity = {
    mythic: { count: 0, value: 0 },
    rare: { count: 0, value: 0 },
    uncommon: { count: 0, value: 0 },
    common: { count: 0, value: 0 },
  };

  let totalValue = 0;
  const cardValues: Array<{ card: DbCard; value: number }> = [];

  for (const card of allCards) {
    const price = card.is_foil
      ? (card.price_usd_foil ?? card.price_usd ?? 0)
      : (card.price_usd ?? 0);
    const cardTotal = price * card.quantity;

    totalValue += cardTotal;
    cardValues.push({ card, value: cardTotal });

    const rarity = card.rarity as keyof typeof byRarity;
    if (byRarity[rarity]) {
      byRarity[rarity].count += card.quantity;
      byRarity[rarity].value += cardTotal;
    }
  }

  const costPaid = session?.cost_paid ?? 0;
  const profitLoss = totalValue - costPaid;
  const profitPercent = costPaid > 0 ? (profitLoss / costPaid) * 100 : 0;

  const topCards = cardValues
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)
    .map((cv) => dbCardToScanned(cv.card));

  return {
    costPaid,
    totalCards: allCards.reduce((sum, c) => sum + c.quantity, 0),
    totalValue,
    profitLoss,
    profitPercent,
    byRarity,
    topCards,
  };
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function colorsFromJson(colors: Json): string[] {
  if (!Array.isArray(colors)) return [];
  return colors.filter((c): c is string => typeof c === "string");
}

export function dbCardToScanned(card: DbCard): ScannedCard {
  return {
    id: card.id,
    sessionId: card.session_id,
    scryfallId: card.scryfall_id,
    name: card.name,
    setCode: card.set_code,
    setName: card.set_name,
    collectorNumber: card.collector_number,
    rarity: card.rarity as ScannedCard["rarity"],
    colors: colorsFromJson(card.colors),
    isFoil: card.is_foil,
    condition: card.condition as ScannedCard["condition"],
    quantity: card.quantity,
    priceUsd: card.price_usd,
    priceUsdFoil: card.price_usd_foil,
    priceFetchedAt: card.price_fetched_at ? new Date(card.price_fetched_at).getTime() : null,
    imageUri: card.image_uri,
    scryfallUri: card.scryfall_uri,
    addedAt: new Date(card.added_at).getTime(),
    destination:
      card.destination === "LGS" || card.destination === "BULK" ? card.destination : null,
  };
}