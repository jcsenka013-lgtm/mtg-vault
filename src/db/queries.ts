import { supabase } from "@/lib/supabase";
import type { DbSession, DbCard } from "@/lib/supabase";
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
  const { error } = await supabase.from("cards").delete().eq("id", id);
  if (error) throw error;
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

export function dbCardToScanned(card: DbCard): ScannedCard {
  return {
    id: card.id,
    sessionId: card.session_id,
    scryfallId: card.scryfall_id,
    name: card.name,
    setCode: card.set_code,
    setName: card.set_name,
    collectorNumber: card.collector_number,
    rarity: card.rarity,
    colors: Array.isArray(card.colors) ? card.colors : [],
    isFoil: card.is_foil,
    condition: card.condition,
    quantity: card.quantity,
    priceUsd: card.price_usd,
    priceUsdFoil: card.price_usd_foil,
    priceFetchedAt: card.price_fetched_at ? new Date(card.price_fetched_at).getTime() : null,
    imageUri: card.image_uri,
    scryfallUri: card.scryfall_uri,
    addedAt: new Date(card.added_at).getTime(),
  };
}
