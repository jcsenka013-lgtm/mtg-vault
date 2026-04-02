import { useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Image,
  Alert,
  Platform,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAppStore } from "@store/appStore";
import { getCardsForSession, deleteCard } from "@db/queries";
import type { DbCard } from "@/lib/supabase";

const RARITY_COLORS: Record<string, string> = {
  mythic: "#e87a3c",
  rare: "#e8c060",
  uncommon: "#8ab4c4",
  common: "#a0a0b0",
};

const SORT_FIELDS = [
  { label: "Date", value: "added_at" },
  { label: "Name", value: "name" },
  { label: "Value", value: "price_usd" },
  { label: "Rarity", value: "rarity" },
];

const RARITIES = ["all", "mythic", "rare", "uncommon", "common"];

export default function InventoryScreen() {
  const {
    activeSession,
    rarityFilter, setRarityFilter,
    foilFilter, setFoilFilter,
    sortField, setSortField,
    sortOrder, setSortOrder,
    searchQuery, setSearchQuery,
  } = useAppStore();
  const [cards, setCards] = useState<DbCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const loadCards = useCallback(async () => {
    if (!activeSession) return;
    setLoading(true);
    try {
      const foilArg = foilFilter === "all" ? undefined : foilFilter === "foil";
      const results = await getCardsForSession(activeSession.id, {
        rarity: rarityFilter !== "all" ? rarityFilter : undefined,
        isFoil: foilArg,
        search: searchQuery,
        sortField,
        sortOrder,
      });
      setCards(results);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [activeSession, rarityFilter, foilFilter, searchQuery, sortField, sortOrder]);

  useFocusEffect(useCallback(() => { loadCards(); }, [loadCards]));

  const totalValue = cards.reduce((sum, c) => {
    const price = c.is_foil ? (c.price_usd_foil ?? c.price_usd ?? 0) : (c.price_usd ?? 0);
    return sum + price * c.quantity;
  }, 0);

  const performDelete = async (id: string) => {
    try {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      await deleteCard(id);
      setCards((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      console.error("Failed to delete card from inventory", e);
      if (Platform.OS === "web") {
        window.alert("Could not delete card.");
      } else {
        Alert.alert("Error", "Could not delete card.");
      }
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleDelete = (id: string, name: string) => {
    if (Platform.OS === "web") {
      if (window.confirm(`Remove "${name}" from your library?`)) {
        performDelete(id);
      }
    } else {
      Alert.alert("Remove Card", `Remove ${name} from your library?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => performDelete(id) },
      ]);
    }
  };

  const renderCard = ({ item }: { item: DbCard }) => {
    const price = item.is_foil ? (item.price_usd_foil ?? item.price_usd) : item.price_usd;
    return (
      <View style={styles.cardRowWrapper}>
        <Pressable style={styles.cardRow} onPress={() => router.push(`/card/${item.id}`)}>
          {item.image_uri ? (
            <Image source={{ uri: item.image_uri }} style={styles.thumb} resizeMode="cover" />
          ) : (
            <View style={[styles.thumb, styles.thumbPlaceholder]}>
              <Text style={styles.thumbEmoji}>🃏</Text>
            </View>
          )}
          <View style={styles.cardInfo}>
            <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
            <View style={styles.cardMeta}>
              <Text style={[styles.rarityTag, { color: RARITY_COLORS[item.rarity] }]}>
                {item.rarity.charAt(0).toUpperCase() + item.rarity.slice(1)}
              </Text>
              <Text style={styles.metaDot}>·</Text>
              <Text style={styles.setTag}>{item.set_code.toUpperCase()}</Text>
              {item.is_foil && <Text style={styles.foilTag}>✨</Text>}
              <Text style={styles.metaDot}>·</Text>
              <Text style={styles.condTag}>{item.condition}</Text>
            </View>
          </View>
          <View style={styles.priceBox}>
            <Text style={styles.price}>
              {price !== null ? `$${Number(price).toFixed(2)}` : "—"}
            </Text>
            {item.quantity > 1 && <Text style={styles.qty}>×{item.quantity}</Text>}
          </View>
        </Pressable>
        <Pressable
          style={[styles.deleteBtn, deletingIds.has(item.id) && styles.deleteBtnDisabled]}
          onPress={() => handleDelete(item.id, item.name)}
          disabled={deletingIds.has(item.id)}
        >
          {deletingIds.has(item.id)
            ? <ActivityIndicator size="small" color="#ef4444" />
            : <Text style={styles.deleteEmoji}>🗑️</Text>
          }
        </Pressable>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Search + Manual Entry */}
      <View style={styles.searchRow}>
        <View style={[styles.searchBar, { flex: 1 }]}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search your library..."
            placeholderTextColor="#606078"
            returnKeyType="search"
            onSubmitEditing={loadCards}
          />
        </View>
        <Pressable style={styles.manualBtn} onPress={() => router.push("/manual-entry" as any)}>
          <Text style={styles.manualBtnText}>✏️</Text>
        </Pressable>
      </View>

      {/* Rarity filters */}
      <View style={styles.filterRow}>
        <FlatList
          horizontal
          data={RARITIES}
          keyExtractor={(i) => i}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.chip, rarityFilter === item && styles.chipActive]}
              onPress={() => setRarityFilter(item)}
            >
              <Text style={[styles.chipText, rarityFilter === item && styles.chipTextActive]}>
                {item === "all" ? "All" : item.charAt(0).toUpperCase() + item.slice(1)}
              </Text>
            </Pressable>
          )}
          contentContainerStyle={{ paddingRight: 8 }}
        />
      </View>

      {/* Sort + Foil */}
      <View style={styles.sortRow}>
        <View style={styles.sortGroup}>
          {SORT_FIELDS.map((f) => (
            <Pressable
              key={f.value}
              style={[styles.sortChip, sortField === f.value && styles.chipActive]}
              onPress={() => {
                if (sortField === f.value) setSortOrder(sortOrder === "asc" ? "desc" : "asc");
                else setSortField(f.value);
              }}
            >
              <Text style={[styles.chipText, sortField === f.value && styles.chipTextActive]}>
                {f.label} {sortField === f.value ? (sortOrder === "asc" ? "↑" : "↓") : ""}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          style={[styles.sortChip, foilFilter === "foil" && styles.chipActive]}
          onPress={() => setFoilFilter(foilFilter === "foil" ? "all" : "foil")}
        >
          <Text style={[styles.chipText, foilFilter === "foil" && styles.chipTextActive]}>✨ Foil</Text>
        </Pressable>
      </View>

      {/* Stats bar */}
      <View style={styles.statsBar}>
        <Text style={styles.statText}>◆ {cards.length} cards in library</Text>
        <Text style={styles.statValue}>${totalValue.toFixed(2)} worth</Text>
      </View>

      {/* List */}
      {!activeSession ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🏰</Text>
          <Text style={styles.emptyText}>No active opening</Text>
          <Pressable style={styles.ctaBtn} onPress={() => router.push("/session/new")}>
            <Text style={styles.ctaBtnText}>Begin an Opening</Text>
          </Pressable>
        </View>
      ) : loading ? (
        <ActivityIndicator color="#c89b3c" style={{ marginTop: 40 }} />
      ) : cards.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🔮</Text>
          <Text style={styles.emptyText}>No cards cataloged yet</Text>
          <Pressable style={styles.ctaBtn} onPress={() => router.replace("/(tabs)/scanner")}>
            <Text style={styles.ctaBtnText}>Start Scrying</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={cards}
          keyExtractor={(c) => c.id}
          renderItem={renderCard}
          contentContainerStyle={{ paddingBottom: 32 }}
          ItemSeparatorComponent={() => <View style={styles.divider} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0f" },
  searchBar: { flexDirection: "row", alignItems: "center", backgroundColor: "#12121a", borderRadius: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: "#222233", marginBottom: 12 },
  searchIcon: { fontSize: 16, marginRight: 8, opacity: 0.6 },
  searchInput: { flex: 1, color: "#f0f0f8", fontSize: 15, paddingVertical: 12 },
  filterRow: { paddingHorizontal: 12, marginBottom: 8 },
  sortRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 12, marginBottom: 8 },
  sortGroup: { flexDirection: "row", gap: 6 },
  chip: { backgroundColor: "#12121a", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginRight: 6, borderWidth: 1, borderColor: "#222233" },
  sortChip: { backgroundColor: "#12121a", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: "#222233" },
  chipActive: { borderColor: "#c89b3c", backgroundColor: "#1e1a0f" },
  chipText: { color: "#a0a0b8", fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: "#c89b3c" },
  statsBar: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 8, backgroundColor: "#12121a", borderTopWidth: 1, borderBottomWidth: 1, borderColor: "#222233" },
  statText: { color: "#606078", fontSize: 13 },
  statValue: { color: "#22c55e", fontWeight: "700", fontSize: 13 },
  cardRowWrapper: { flexDirection: "row", alignItems: "center" },
  cardRow: { flex: 1, flexDirection: "row", alignItems: "center", padding: 12, paddingLeft: 16 },
  deleteBtn: { padding: 16, paddingRight: 20 },
  deleteBtnDisabled: { opacity: 0.5 },
  deleteEmoji: { fontSize: 18 },
  thumb: { width: 44, height: 60, borderRadius: 4, marginRight: 12 },
  thumbPlaceholder: { backgroundColor: "#1a1a26", alignItems: "center", justifyContent: "center" },
  thumbEmoji: { fontSize: 20 },
  cardInfo: { flex: 1 },
  cardName: { color: "#f0f0f8", fontWeight: "700", fontSize: 15, marginBottom: 4 },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: 4 },
  rarityTag: { fontSize: 12, fontWeight: "600" },
  setTag: { color: "#606078", fontSize: 12 },
  foilTag: { fontSize: 12 },
  condTag: { color: "#606078", fontSize: 12 },
  metaDot: { color: "#3a3a4a", fontSize: 12 },
  priceBox: { alignItems: "flex-end" },
  price: { color: "#22c55e", fontWeight: "800", fontSize: 16 },
  qty: { color: "#606078", fontSize: 12, marginTop: 2 },
  divider: { height: 1, backgroundColor: "#12121a", marginLeft: 72 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { color: "#a0a0b8", fontSize: 16, marginBottom: 20 },
  ctaBtn: { backgroundColor: "#c89b3c", borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  ctaBtnText: { color: "#0a0a0f", fontWeight: "800" },
  searchRow: { flexDirection: "row", alignItems: "center", marginHorizontal: 12, marginTop: 12, marginBottom: 0, gap: 8 },
  manualBtn: { backgroundColor: "#1a1a26", borderRadius: 12, borderWidth: 1, borderColor: "#c89b3c", paddingHorizontal: 14, paddingVertical: 13 },
  manualBtnText: { fontSize: 18 },
});
