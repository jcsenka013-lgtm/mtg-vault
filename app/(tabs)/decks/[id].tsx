import { useState, useEffect, useCallback, useRef } from "react";
import {
  View, Text, FlatList, Pressable, Image, TextInput,
  ImageBackground, StyleSheet, Alert, ActivityIndicator,
  Modal, Platform, ScrollView,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { supabase } from "@/lib/supabase";
import type { DbDeck } from "@/lib/supabase";
import { routes } from "@/navigation/routes";
import { searchCardByName, autocompleteCardName } from "@api/scryfall";
import type { ScryfallCard } from "@mtgtypes/index";

// ─── Types ────────────────────────────────────────────────────────────────────
interface DeckCard {
  id: string;         // deck_cards row id
  card_id: string;    // scryfall_id stored as text
  name: string;
  mana_cost: string | null;
  type_line: string | null;
  rarity: string;
  image_uri: string | null;
  quantity: number;
  zone: "mainboard" | "sideboard" | "commander";
}

const RARITY_COLORS: Record<string, string> = {
  mythic: "#e87a3c",
  rare:   "#e8c060",
  uncommon:"#8ab4c4",
  common: "#a0a0b0",
};

// ─── Component ───────────────────────────────────────────────────────────────
export default function DeckDetailScreen() {
  const { id: deckId } = useLocalSearchParams<{ id: string }>();
  const [deck, setDeck] = useState<DbDeck | null>(null);
  const [deckCards, setDeckCards] = useState<DeckCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState("");

  // Card search modal state
  const [searchOpen, setSearchOpen] = useState(false);
  const [addZone, setAddZone] = useState<DeckCard["zone"]>("mainboard");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch deck + cards ─────────────────────────────────────────────────────
  const fetchDeck = useCallback(async () => {
    if (!deckId) return;
    setLoading(true);
    try {
      const { data: deckData, error: dErr } = await supabase
        .from("decks")
        .select("*")
        .eq("id", deckId)
        .single();
      if (dErr) throw dErr;
      setDeck(deckData);
      setEditName(deckData.name);

      const { data: cardRows, error: cErr } = await supabase
        .from("deck_cards")
        .select("id, card_id, quantity, zone, name, mana_cost, type_line, rarity, image_uri")
        .eq("deck_id", deckId)
        .order("zone")
        .order("name");
      if (cErr) throw cErr;
      setDeckCards((cardRows ?? []) as DeckCard[]);
    } catch (e: unknown) {
      console.error("fetchDeck:", e);
    } finally {
      setLoading(false);
    }
  }, [deckId]);

  useEffect(() => { fetchDeck(); }, [fetchDeck]);

  // ── Deck name save ──────────────────────────────────────────────────────────
  const saveName = async () => {
    if (!editName.trim()) return;
    await supabase.from("decks").update({ name: editName.trim() }).eq("id", deckId);
    setDeck((prev) => (prev ? { ...prev, name: editName.trim() } : prev));
    setEditingName(false);
  };

  // ── Quantity control ────────────────────────────────────────────────────────
  const changeQuantity = async (rowId: string, delta: number, current: number) => {
    const next = current + delta;
    if (next <= 0) {
      await supabase.from("deck_cards").delete().eq("id", rowId);
    } else {
      await supabase.from("deck_cards").update({ quantity: next }).eq("id", rowId);
    }
    fetchDeck();
  };

  // ── Delete deck ─────────────────────────────────────────────────────────────
  const deleteDeck = async () => {
    const ok = typeof window !== "undefined"
      ? window.confirm(`Delete "${deck?.name}"?`)
      : await new Promise<boolean>(res =>
          Alert.alert("Delete Deck", `Delete "${deck?.name}"?`, [
            { text: "Cancel", onPress: () => res(false), style: "cancel" },
            { text: "Delete", onPress: () => res(true), style: "destructive" },
          ])
        );
    if (!ok) return;
    await supabase.from("deck_cards").delete().eq("deck_id", deckId);
    await supabase.from("decks").delete().eq("id", deckId);
    router.replace(routes.tabsDecks());
  };

  // ── Card Search ─────────────────────────────────────────────────────────────
  const runSearch = useCallback(async (name: string) => {
    if (!name.trim()) { setResults([]); setSuggestions([]); return; }
    setSearching(true);
    try {
      const [cards, sug] = await Promise.all([
        searchCardByName(name),
        autocompleteCardName(name),
      ]);
      setResults(cards.slice(0, 20));
      setSuggestions(sug.slice(0, 5));
    } catch { /* non-fatal */ } finally {
      setSearching(false);
    }
  }, []);

  const onQueryChange = (text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(text), 500);
  };

  // ── Add card to deck ────────────────────────────────────────────────────────
  const addCard = async (card: ScryfallCard) => {
    const imageUri =
      card.image_uris?.normal ??
      card.image_uris?.small ??
      card.card_faces?.[0]?.image_uris?.normal ??
      null;

    // Check if already in deck in this zone
    const existing = deckCards.find(
      dc => dc.card_id === card.id && dc.zone === addZone
    );

    if (existing) {
      await supabase
        .from("deck_cards")
        .update({ quantity: existing.quantity + 1 })
        .eq("id", existing.id);
    } else {
      await supabase.from("deck_cards").insert({
        deck_id: deckId,
        card_id: card.id,
        quantity: 1,
        zone: addZone,
        name: card.name,
        mana_cost: card.mana_cost ?? null,
        type_line: card.type_line ?? null,
        rarity: card.rarity ?? "common",
        image_uri: imageUri,
      });
    }
    fetchDeck();
    setSearchOpen(false);
    setQuery("");
    setResults([]);
    setSuggestions([]);
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const mainboard   = deckCards.filter(c => c.zone === "mainboard");
  const sideboard   = deckCards.filter(c => c.zone === "sideboard");
  const commander   = deckCards.filter(c => c.zone === "commander");
  const totalCards  = deckCards.reduce((s, c) => s + c.quantity, 0);

  // ─────────────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={S.container}>
        <ActivityIndicator size="large" color="#c89b3c" style={{ marginTop: 60 }} />
      </View>
    );
  }

  if (!deck) {
    return (
      <View style={S.center}>
        <Text style={S.errorText}>Deck not found</Text>
        <Pressable onPress={() => router.back()} style={S.backBtn}>
          <Text style={S.backBtnText}>← Back to Decks</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={S.container}>
      {/* Header */}
      <ImageBackground
        source={require("../../../assets/bg-planeswalkers.jpg")}
        style={S.header}
        resizeMode="cover"
        imageStyle={{ opacity: 0.25 }}
      >
        <View style={S.headerOverlay}>
          <Pressable onPress={() => router.back()} style={S.backBtn}>
            <Text style={S.backBtnText}>←  Decks</Text>
          </Pressable>
          {editingName ? (
            <View style={S.editRow}>
              <TextInput
                style={S.deckNameInput}
                value={editName}
                onChangeText={setEditName}
                onSubmitEditing={saveName}
                autoFocus
                returnKeyType="done"
                placeholder="Deck name"
                placeholderTextColor="#606078"
              />
              <Pressable style={S.saveBtn} onPress={saveName}>
                <Text style={S.saveBtnText}>Save</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => setEditingName(true)} style={S.deckNameRow}>
              <Text style={S.deckNameText} numberOfLines={1}>{deck.name}</Text>
              <Text style={S.editIcon}>✏️</Text>
            </Pressable>
          )}
          <Text style={S.deckMeta}>
            {deck.format ?? "Draft"}  ·  {totalCards} cards  ·  {deck.created_at ? new Date(deck.created_at).toLocaleDateString() : "—"}
          </Text>
        </View>
      </ImageBackground>

      {/* Add card FAB-style bar */}
      <View style={S.addBar}>
        <Text style={S.addBarLabel}>Add to:</Text>
        {(["mainboard", "sideboard", "commander"] as const).map(z => (
          <Pressable
            key={z}
            style={[S.zoneTab, addZone === z && S.zoneTabActive]}
            onPress={() => setAddZone(z)}
          >
            <Text style={[S.zoneTabText, addZone === z && S.zoneTabTextActive]}>
              {z.charAt(0).toUpperCase() + z.slice(1)}
            </Text>
          </Pressable>
        ))}
        <Pressable style={S.searchFab} onPress={() => setSearchOpen(true)}>
          <Text style={S.searchFabText}>＋ Search Card</Text>
        </Pressable>
      </View>

      {/* Decklist */}
      <ScrollView style={S.scroll} contentContainerStyle={{ padding: 14, paddingBottom: 48 }}>
        {mainboard.length > 0 && (
          <Zone title="Mainboard" cards={mainboard} onChange={changeQuantity} />
        )}
        {sideboard.length > 0 && (
          <Zone title="Sideboard" cards={sideboard} onChange={changeQuantity} />
        )}
        {commander.length > 0 && (
          <Zone title="Commander" cards={commander} onChange={changeQuantity} />
        )}
        {deckCards.length === 0 && (
          <View style={S.emptyDeck}>
            <Text style={S.emptyEmoji}>🃏</Text>
            <Text style={S.emptyTitle}>Deck is empty</Text>
            <Text style={S.emptyText}>
              Tap "＋ Search Card" above to find and add cards to your deck.
            </Text>
          </View>
        )}

        <Pressable style={S.deleteBtn} onPress={deleteDeck}>
          <Text style={S.deleteBtnText}>🗑️  Delete This Deck</Text>
        </Pressable>
      </ScrollView>

      {/* ── Card Search Modal ──────────────────────────────────────────────── */}
      <Modal
        visible={searchOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSearchOpen(false)}
      >
        <View style={S.modal}>
          {/* Modal header */}
          <View style={S.modalHeader}>
            <Text style={S.modalTitle}>Add to {addZone}</Text>
            <Pressable onPress={() => setSearchOpen(false)} style={S.modalClose}>
              <Text style={S.modalCloseText}>✕</Text>
            </Pressable>
          </View>

          {/* Search input */}
          <View style={S.searchBar}>
            <Text style={S.searchIcon}>🔍</Text>
            <TextInput
              style={S.searchInput}
              value={query}
              onChangeText={onQueryChange}
              placeholder="Type a card name…"
              placeholderTextColor="#606078"
              autoFocus
              clearButtonMode="while-editing"
            />
            {searching && <ActivityIndicator color="#c89b3c" style={{ marginLeft: 8 }} />}
          </View>

          {/* Autocomplete suggestions */}
          {suggestions.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={S.sugsRow}>
              {suggestions.map(s => (
                <Pressable
                  key={s}
                  style={S.sugChip}
                  onPress={() => { setQuery(s); runSearch(s); }}
                >
                  <Text style={S.sugChipText}>{s}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {/* Results */}
          <FlatList
            data={results}
            keyExtractor={c => c.id}
            contentContainerStyle={{ paddingBottom: 40 }}
            ListEmptyComponent={
              query.length > 1 && !searching ? (
                <View style={S.noResults}>
                  <Text style={S.noResultsText}>No cards found for "{query}"</Text>
                </View>
              ) : null
            }
            renderItem={({ item: card }) => {
              const imgUri =
                card.image_uris?.small ??
                card.card_faces?.[0]?.image_uris?.small ??
                null;
              const price = card.prices?.usd
                ? `$${parseFloat(card.prices.usd).toFixed(2)}`
                : null;
              return (
                <Pressable style={S.resultRow} onPress={() => addCard(card)}>
                  {imgUri ? (
                    <Image source={{ uri: imgUri }} style={S.resultThumb} />
                  ) : (
                    <View style={[S.resultThumb, S.resultThumbBlank]}>
                      <Text>🃏</Text>
                    </View>
                  )}
                  <View style={S.resultInfo}>
                    <Text style={S.resultName} numberOfLines={1}>{card.name}</Text>
                    <Text style={S.resultType} numberOfLines={1}>{card.type_line}</Text>
                    <View style={S.resultMeta}>
                      <Text style={[S.resultRarity, { color: RARITY_COLORS[card.rarity] ?? "#a0a0b8" }]}>
                        {card.rarity?.charAt(0).toUpperCase()}
                      </Text>
                      {card.mana_cost ? (
                        <Text style={S.resultMana}>{card.mana_cost}</Text>
                      ) : null}
                      {card.set ? (
                        <Text style={S.resultSet}>{card.set.toUpperCase()}</Text>
                      ) : null}
                    </View>
                  </View>
                  <View style={S.resultRight}>
                    {price ? <Text style={S.resultPrice}>{price}</Text> : null}
                    <View style={S.addBtn}>
                      <Text style={S.addBtnText}>＋</Text>
                    </View>
                  </View>
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </View>
  );
}

// ── Zone section component ─────────────────────────────────────────────────────
function Zone({
  title,
  cards,
  onChange,
}: {
  title: string;
  cards: DeckCard[];
  onChange: (id: string, delta: number, current: number) => void;
}) {
  const total = cards.reduce((s, c) => s + c.quantity, 0);
  return (
    <View style={S.zone}>
      <View style={S.zoneHeader}>
        <Text style={S.zoneTitle}>{title}</Text>
        <Text style={S.zoneBadge}>{total}</Text>
      </View>
      {cards.map(card => (
        <View key={card.id} style={S.cardRow}>
          {card.image_uri ? (
            <Image source={{ uri: card.image_uri }} style={S.cardThumb} />
          ) : (
            <View style={[S.cardThumb, S.cardThumbBlank]}>
              <Text style={{ fontSize: 14 }}>🃏</Text>
            </View>
          )}
          <View style={S.cardInfo}>
            <Text style={S.cardName} numberOfLines={1}>{card.name}</Text>
            <View style={S.cardMeta}>
              <Text style={[S.cardRarity, { color: RARITY_COLORS[card.rarity] ?? "#a0a0b8" }]}>
                {card.rarity?.charAt(0).toUpperCase()}
              </Text>
              {card.mana_cost ? <Text style={S.cardMana}>{card.mana_cost}</Text> : null}
            </View>
          </View>
          <View style={S.cardControls}>
            <Pressable style={S.qtyBtn} onPress={() => onChange(card.id, -1, card.quantity)}>
              <Text style={S.qtyBtnText}>−</Text>
            </Pressable>
            <Text style={S.qtyValue}>{card.quantity}</Text>
            <Pressable style={S.qtyBtn} onPress={() => onChange(card.id, +1, card.quantity)}>
              <Text style={S.qtyBtnText}>＋</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────
const CARD   = "#12121a";
const BORDER = "#222233";
const GOLD   = "#c89b3c";
const DIM    = "#606078";
const WHITE  = "#f0f0f8";

const S = StyleSheet.create({
  container:   { flex: 1, backgroundColor: "#0a0a0f" },
  scroll:      { flex: 1 },
  center:      { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  errorText:   { color: WHITE, fontSize: 18, fontWeight: "700", marginBottom: 16 },

  // Header
  header:        { height: 180, width: "100%" },
  headerOverlay: { flex: 1, backgroundColor: "rgba(5,5,12,0.70)", padding: 16, justifyContent: "flex-end" },
  backBtn:       { paddingHorizontal: 0, paddingVertical: 4, marginBottom: 8 },
  backBtnText:   { color: GOLD, fontWeight: "700", fontSize: 14 },
  editRow:       { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  deckNameInput: { flex: 1, backgroundColor: "rgba(26,26,38,0.9)", borderRadius: 10, padding: 10, color: WHITE, fontSize: 18, fontWeight: "700", borderWidth: 1, borderColor: GOLD },
  saveBtn:       { backgroundColor: GOLD, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  saveBtnText:   { color: "#0a0a0f", fontWeight: "900", fontSize: 13 },
  deckNameRow:   { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  deckNameText:  { color: WHITE, fontSize: 22, fontWeight: "900", flex: 1 },
  editIcon:      { fontSize: 16 },
  deckMeta:      { color: DIM, fontSize: 12, fontWeight: "600" },

  // Add card bar
  addBar:         { flexDirection: "row", alignItems: "center", backgroundColor: CARD, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderColor: BORDER, gap: 8, flexWrap: "wrap" },
  addBarLabel:    { color: DIM, fontSize: 11, fontWeight: "700" },
  zoneTab:        { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: BORDER },
  zoneTabActive:  { borderColor: GOLD, backgroundColor: "#1e1a0f" },
  zoneTabText:    { color: DIM, fontSize: 11, fontWeight: "700" },
  zoneTabTextActive: { color: GOLD },
  searchFab:      { marginLeft: "auto", backgroundColor: GOLD, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  searchFabText:  { color: "#0a0a0f", fontWeight: "900", fontSize: 13 },

  // Zone sections
  zone:        { marginBottom: 24 },
  zoneHeader:  { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  zoneTitle:   { color: GOLD, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, flex: 1 },
  zoneBadge:   { backgroundColor: "rgba(200,155,60,0.15)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3, color: GOLD, fontSize: 12, fontWeight: "700" },

  // Card rows
  cardRow:       { flexDirection: "row", alignItems: "center", backgroundColor: CARD, borderRadius: 12, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: BORDER },
  cardThumb:     { width: 36, height: 50, borderRadius: 4, marginRight: 10 },
  cardThumbBlank:{ backgroundColor: "#1a1a26", alignItems: "center", justifyContent: "center" },
  cardInfo:      { flex: 1 },
  cardName:      { color: WHITE, fontWeight: "700", fontSize: 14, marginBottom: 4 },
  cardMeta:      { flexDirection: "row", alignItems: "center", gap: 6 },
  cardRarity:    { fontSize: 11, fontWeight: "700" },
  cardMana:      { color: DIM, fontSize: 11 },
  cardControls:  { flexDirection: "row", alignItems: "center", gap: 8 },
  qtyBtn:        { width: 28, height: 28, borderRadius: 14, backgroundColor: "#222233", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#333344" },
  qtyBtnText:    { color: WHITE, fontWeight: "900", fontSize: 16, lineHeight: 20 },
  qtyValue:      { color: WHITE, fontSize: 16, fontWeight: "800", minWidth: 22, textAlign: "center" },

  // Empty state
  emptyDeck:  { alignItems: "center", paddingVertical: 60 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { color: WHITE, fontSize: 18, fontWeight: "700", marginBottom: 8 },
  emptyText:  { color: DIM, textAlign: "center", lineHeight: 20 },

  deleteBtn:     { marginTop: 16, borderRadius: 12, padding: 14, alignItems: "center", borderWidth: 1, borderColor: "rgba(239,68,68,0.3)", backgroundColor: "rgba(239,68,68,0.08)" },
  deleteBtnText: { color: "#ef4444", fontWeight: "700", fontSize: 14 },

  // Search Modal
  modal:        { flex: 1, backgroundColor: "#0a0a0f" },
  modalHeader:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderColor: BORDER },
  modalTitle:   { color: WHITE, fontSize: 18, fontWeight: "800", textTransform: "capitalize" },
  modalClose:   { padding: 8 },
  modalCloseText: { color: DIM, fontSize: 20, fontWeight: "700" },

  searchBar:    { flexDirection: "row", alignItems: "center", backgroundColor: CARD, margin: 14, borderRadius: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: BORDER },
  searchIcon:   { fontSize: 16, marginRight: 8, opacity: 0.6 },
  searchInput:  { flex: 1, color: WHITE, fontSize: 15, paddingVertical: 13 },

  sugsRow:      { paddingHorizontal: 14, marginBottom: 8 },
  sugChip:      { backgroundColor: CARD, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8, borderWidth: 1, borderColor: GOLD },
  sugChipText:  { color: GOLD, fontSize: 12, fontWeight: "600" },

  noResults:    { padding: 24, alignItems: "center" },
  noResultsText:{ color: DIM, fontSize: 14 },

  resultRow:       { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderColor: BORDER },
  resultThumb:     { width: 42, height: 58, borderRadius: 4, marginRight: 12 },
  resultThumbBlank:{ backgroundColor: "#1a1a26", alignItems: "center", justifyContent: "center" },
  resultInfo:      { flex: 1 },
  resultName:      { color: WHITE, fontWeight: "700", fontSize: 14, marginBottom: 3 },
  resultType:      { color: DIM, fontSize: 11, marginBottom: 3 },
  resultMeta:      { flexDirection: "row", alignItems: "center", gap: 6 },
  resultRarity:    { fontSize: 11, fontWeight: "800" },
  resultMana:      { color: "#a0a0b8", fontSize: 11 },
  resultSet:       { color: DIM, fontSize: 11, textTransform: "uppercase" },
  resultRight:     { alignItems: "center", gap: 6, marginLeft: 12 },
  resultPrice:     { color: "#22c55e", fontWeight: "700", fontSize: 13 },
  addBtn:          { width: 30, height: 30, borderRadius: 15, backgroundColor: GOLD, alignItems: "center", justifyContent: "center" },
  addBtnText:      { color: "#0a0a0f", fontWeight: "900", fontSize: 18, lineHeight: 22 },
});