import { useState, useEffect } from "react";
import {
  View,
  Text,
  Image,
  ScrollView,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Linking,
  Switch,
} from "react-native";
import { useLocalSearchParams, router, Stack } from "expo-router";
import { supabase } from "@/lib/supabase";
import type { DbCard } from "@/lib/supabase";
import { deleteCard, updateCardFoil, updateCardCondition, updateCardPrices } from "@db/queries";
import { refreshCardPrice } from "@api/scryfall";

const RARITY_COLORS: Record<string, string> = {
  mythic: "#e87a3c",
  rare: "#e8c060",
  uncommon: "#8ab4c4",
  common: "#a0a0b0",
};
const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;

export default function CardDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [card, setCard] = useState<DbCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { loadCard(); }, [id]);

  const loadCard = async () => {
    try {
      const { data, error } = await supabase
        .from("cards")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      setCard(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleFoil = async () => {
    if (!card) return;
    await updateCardFoil(card.id, !card.is_foil);
    setCard((prev) => prev ? { ...prev, is_foil: !prev.is_foil } : prev);
  };

  const handleCondition = async (cond: string) => {
    if (!card) return;
    await updateCardCondition(card.id, cond);
    setCard((prev) => prev ? { ...prev, condition: cond as DbCard["condition"] } : prev);
  };

  const handleRefreshPrice = async () => {
    if (!card) return;
    setRefreshing(true);
    try {
      const prices = await refreshCardPrice(card.scryfall_id);
      if (prices) {
        await updateCardPrices(card.id, prices.usd, prices.usdFoil);
        setCard((prev) =>
          prev ? { ...prev, price_usd: prices.usd, price_usd_foil: prices.usdFoil, price_fetched_at: new Date().toISOString() } : prev
        );
      }
    } catch {
      Alert.alert("Error", "Could not refresh price.");
    } finally {
      setRefreshing(false);
    }
  };

  const handleDelete = () => {
    Alert.alert("Remove Card", `Remove ${card?.name} from this session?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          if (card) { await deleteCard(card.id); router.back(); }
        },
      },
    ]);
  };

  if (loading) return <ActivityIndicator color="#c89b3c" style={{ flex: 1, backgroundColor: "#0a0a0f" }} />;
  if (!card) return (
    <View style={styles.center}><Text style={styles.emptyText}>Card not found</Text></View>
  );

  const price = card.is_foil ? (card.price_usd_foil ?? card.price_usd) : card.price_usd;
  const fetchedDate = card.price_fetched_at
    ? new Date(card.price_fetched_at).toLocaleDateString()
    : "never";

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: card.name }} />
      <ScrollView contentContainerStyle={styles.content}>
        {card.image_uri ? (
          <Image source={{ uri: card.image_uri }} style={styles.cardImage} resizeMode="contain" />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Text style={styles.imagePlaceholderText}>🃏</Text>
          </View>
        )}

        <Text style={styles.cardName}>{card.name}</Text>
        <View style={styles.metaRow}>
          <Text style={[styles.rarityTag, { color: RARITY_COLORS[card.rarity] }]}>
            {card.rarity.charAt(0).toUpperCase() + card.rarity.slice(1)}
          </Text>
          <Text style={styles.dot}>·</Text>
          <Text style={styles.metaText}>{card.set_code.toUpperCase()} #{card.collector_number}</Text>
          <Text style={styles.dot}>·</Text>
          <Text style={styles.metaText}>{card.set_name}</Text>
        </View>

        <View style={styles.priceSection}>
          <View style={styles.pricePair}>
            <View style={styles.priceBlock}>
              <Text style={styles.priceLabel}>Non-Foil</Text>
              <Text style={[styles.priceValue, { color: "#22c55e" }]}>
                {card.price_usd ? `$${Number(card.price_usd).toFixed(2)}` : "N/A"}
              </Text>
            </View>
            <View style={styles.priceDivider} />
            <View style={styles.priceBlock}>
              <Text style={styles.priceLabel}>✨ Foil</Text>
              <Text style={[styles.priceValue, { color: "#4a9eff" }]}>
                {card.price_usd_foil ? `$${Number(card.price_usd_foil).toFixed(2)}` : "N/A"}
              </Text>
            </View>
          </View>
          <View style={styles.selectedPrice}>
            <Text style={styles.selectedPriceLabel}>Your Card Value</Text>
            <Text style={styles.selectedPriceValue}>
              {price ? `$${Number(price).toFixed(2)}` : "—"}
            </Text>
          </View>
          <Pressable style={styles.refreshBtn} onPress={handleRefreshPrice} disabled={refreshing}>
            {refreshing
              ? <ActivityIndicator color="#c89b3c" size="small" />
              : <Text style={styles.refreshBtnText}>🔄 Refresh Prices (last: {fetchedDate})</Text>
            }
          </Pressable>
        </View>

        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>✨ Foil Card</Text>
          <Switch
            value={card.is_foil}
            onValueChange={handleToggleFoil}
            trackColor={{ false: "#222233", true: "#4a9eff" }}
            thumbColor="#f0f0f8"
          />
        </View>

        <Text style={styles.sectionLabel}>Condition</Text>
        <View style={styles.conditionRow}>
          {CONDITIONS.map((c) => (
            <Pressable
              key={c}
              style={[styles.condBtn, card.condition === c && styles.condBtnActive]}
              onPress={() => handleCondition(c)}
            >
              <Text style={[styles.condBtnText, card.condition === c && styles.condBtnTextActive]}>{c}</Text>
            </Pressable>
          ))}
        </View>

        {card.scryfall_uri && (
          <Pressable style={styles.linkBtn} onPress={() => Linking.openURL(card.scryfall_uri!)}>
            <Text style={styles.linkBtnText}>🔗 View on Scryfall</Text>
          </Pressable>
        )}

        <Pressable style={styles.deleteBtn} onPress={handleDelete}>
          <Text style={styles.deleteBtnText}>🗑 Remove from Collection</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0f" },
  content: { padding: 20, alignItems: "center", paddingBottom: 48 },
  center: { flex: 1, backgroundColor: "#0a0a0f", alignItems: "center", justifyContent: "center" },
  emptyText: { color: "#a0a0b8" },
  cardImage: { width: 240, height: 335, borderRadius: 12, marginBottom: 20 },
  imagePlaceholder: { width: 240, height: 335, borderRadius: 12, backgroundColor: "#12121a", alignItems: "center", justifyContent: "center", marginBottom: 20 },
  imagePlaceholderText: { fontSize: 64 },
  cardName: { color: "#f0f0f8", fontSize: 24, fontWeight: "900", textAlign: "center", marginBottom: 8 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "center", marginBottom: 20 },
  rarityTag: { fontSize: 13, fontWeight: "700" },
  dot: { color: "#3a3a4a" },
  metaText: { color: "#a0a0b8", fontSize: 13 },
  priceSection: { width: "100%", backgroundColor: "#12121a", borderRadius: 16, marginBottom: 16, borderWidth: 1, borderColor: "#222233", overflow: "hidden" },
  pricePair: { flexDirection: "row" },
  priceBlock: { flex: 1, alignItems: "center", padding: 16 },
  priceDivider: { width: 1, backgroundColor: "#222233" },
  priceLabel: { color: "#606078", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  priceValue: { fontSize: 20, fontWeight: "800" },
  selectedPrice: { borderTopWidth: 1, borderColor: "#222233", padding: 16, alignItems: "center" },
  selectedPriceLabel: { color: "#606078", fontSize: 11, textTransform: "uppercase", marginBottom: 4 },
  selectedPriceValue: { color: "#c89b3c", fontSize: 32, fontWeight: "900" },
  refreshBtn: { borderTopWidth: 1, borderColor: "#222233", padding: 12, alignItems: "center" },
  refreshBtnText: { color: "#a0a0b8", fontSize: 13 },
  settingRow: { width: "100%", flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#12121a", borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: "#222233" },
  settingLabel: { color: "#f0f0f8", fontSize: 15, fontWeight: "600" },
  sectionLabel: { color: "#a0a0b8", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10, alignSelf: "flex-start" },
  conditionRow: { flexDirection: "row", gap: 8, width: "100%", marginBottom: 16 },
  condBtn: { flex: 1, backgroundColor: "#12121a", borderRadius: 10, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: "#222233" },
  condBtnActive: { backgroundColor: "#1e1a0f", borderColor: "#c89b3c" },
  condBtnText: { color: "#a0a0b8", fontWeight: "700" },
  condBtnTextActive: { color: "#c89b3c" },
  linkBtn: { width: "100%", backgroundColor: "#12121a", borderRadius: 14, padding: 16, alignItems: "center", borderWidth: 1, borderColor: "#222233", marginBottom: 12 },
  linkBtnText: { color: "#4a9eff", fontWeight: "700" },
  deleteBtn: { width: "100%", backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 14, padding: 16, alignItems: "center", borderWidth: 1, borderColor: "rgba(239,68,68,0.3)" },
  deleteBtnText: { color: "#ef4444", fontWeight: "700" },
});
