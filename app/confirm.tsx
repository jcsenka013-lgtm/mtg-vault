import { useState, useEffect } from "react";
import {
  View, Text, Image, Pressable, ScrollView,
  ActivityIndicator, StyleSheet, Alert, Switch,
  TextInput,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useAppStore } from "@store/appStore";
import { normalizeScryfallCard, searchCardByName, autocompleteCardName } from "@api/scryfall";
import { addCard } from "@db/queries";
import * as Haptics from "expo-haptics";
import type { ScryfallCard } from "@mtgtypes/index";
import "react-native-get-random-values";
import { v4 as uuidv4 } from "uuid";

const RARITY_COLORS: Record<string, string> = {
  mythic: "#e87a3c", rare: "#e8c060", uncommon: "#8ab4c4", common: "#a0a0b0",
};
const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;

export default function ConfirmScreen() {
  const params = useLocalSearchParams<{ candidates?: string; sessionId: string }>();
  const { activeSession } = useAppStore();
  const sessionId = params.sessionId || activeSession?.id || "";

  const [candidates, setCandidates] = useState<ScryfallCard[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isFoil, setIsFoil] = useState(false);
  const [condition, setCondition] = useState<"NM" | "LP" | "MP" | "HP" | "DMG">("NM");
  const [saving, setSaving] = useState(false);

  // Manual search state
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (params.candidates) {
      try {
        const parsed = JSON.parse(params.candidates) as ScryfallCard[];
        setCandidates(parsed);
      } catch {
        setCandidates([]);
      }
    }
  }, [params.candidates]);

  const handleSearch = async (query: string) => {
    if (!query.trim()) return;
    setIsSearching(true);
    setSuggestions([]);
    try {
      const results = await searchCardByName(query);
      if (results.length > 0) {
        setCandidates(results);
        setSelectedIndex(0);
        setSearchQuery("");
      } else {
        Alert.alert("No results", "Could not find any cards by that name.");
      }
    } catch (e) {
      Alert.alert("Error", "Search failed.");
    } finally {
      setIsSearching(false);
    }
  };

  const handleAutocomplete = async (text: string) => {
    setSearchQuery(text);
    if (text.length > 2) {
      const results = await autocompleteCardName(text);
      setSuggestions(results);
    } else {
      setSuggestions([]);
    }
  };

  const card = candidates[selectedIndex] ?? null;
  const normalized = card ? normalizeScryfallCard(card) : null;
  const price = normalized
    ? (isFoil ? (normalized.priceUsdFoil ?? normalized.priceUsd) : normalized.priceUsd)
    : null;

  const handleConfirm = async () => {
    if (!card || !normalized || !sessionId) return;
    setSaving(true);
    try {
      await addCard({
        sessionId,
        scryfallId: normalized.scryfallId,
        name: normalized.name,
        setCode: normalized.setCode,
        setName: normalized.setName,
        collectorNumber: normalized.collectorNumber,
        rarity: normalized.rarity,
        colors: normalized.colors,
        isFoil,
        condition,
        quantity: 1,
        priceUsd: normalized.priceUsd,
        priceUsdFoil: normalized.priceUsdFoil,
        imageUri: normalized.imageUri,
        scryfallUri: normalized.scryfallUri,
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e) {
      Alert.alert("Error", "Failed to save card. Please try again.");
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Manual search bar */}
        <View style={styles.searchSection}>
          <View style={styles.searchBar}>
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={handleAutocomplete}
              placeholder="Search card name..."
              placeholderTextColor="#606078"
              onSubmitEditing={() => handleSearch(searchQuery)}
              returnKeyType="search"
            />
            {isSearching && <ActivityIndicator color="#c89b3c" size="small" />}
          </View>
          {suggestions.length > 0 && (
            <View style={styles.suggestions}>
              {suggestions.map((s: string) => (
                <Pressable key={s} style={styles.suggestionItem} onPress={() => handleSearch(s)}>
                  <Text style={styles.suggestionText}>{s}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {card ? (
          <View style={styles.imageWrapper}>
            <Image source={{ uri: normalized?.imageUri ?? undefined }} style={styles.cardImage} resizeMode="contain" />
          </View>
        ) : (
          !isSearching && (
            <View style={styles.noCardBox}>
              <Text style={styles.noCardEmoji}>🃏</Text>
              <Text style={styles.noCardText}>Search for a card above</Text>
              <Text style={styles.noCardSub}>Enter the name manually to begin</Text>
            </View>
          )
        )}

        {card && normalized && (
          <>
            <Text style={styles.cardName}>{normalized.name}</Text>
            <View style={styles.metaRow}>
              <Text style={[styles.rarity, { color: RARITY_COLORS[normalized.rarity] ?? "#a0a0b0" }]}>
                {normalized.rarity.charAt(0).toUpperCase() + normalized.rarity.slice(1)}
              </Text>
              <Text style={styles.metaDot}>·</Text>
              <Text style={styles.setCode}>{normalized.setCode.toUpperCase()} #{normalized.collectorNumber}</Text>
              <Text style={styles.metaDot}>·</Text>
              <Text style={styles.setName}>{normalized.setName}</Text>
            </View>

            <View style={styles.priceRow}>
              <View style={styles.priceBlock}>
                <Text style={styles.priceLabel}>Non-Foil</Text>
                <Text style={[styles.priceValue, { color: normalized.priceUsd ? "#22c55e" : "#606078" }]}>
                  {normalized.priceUsd ? `$${normalized.priceUsd.toFixed(2)}` : "N/A"}
                </Text>
              </View>
              <View style={styles.priceDivider} />
              <View style={styles.priceBlock}>
                <Text style={styles.priceLabel}>✨ Foil</Text>
                <Text style={[styles.priceValue, { color: normalized.priceUsdFoil ? "#4a9eff" : "#606078" }]}>
                  {normalized.priceUsdFoil ? `$${normalized.priceUsdFoil.toFixed(2)}` : "N/A"}
                </Text>
              </View>
              <View style={styles.priceDivider} />
              <View style={styles.priceBlock}>
                <Text style={styles.priceLabel}>Selected</Text>
                <Text style={[styles.priceValue, { color: "#c89b3c", fontSize: 22 }]}>
                  {price ? `$${price.toFixed(2)}` : "—"}
                </Text>
              </View>
            </View>

            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>✨ Foil Card</Text>
              <Switch
                value={isFoil}
                onValueChange={setIsFoil}
                trackColor={{ false: "#222233", true: "#4a9eff" }}
                thumbColor="#f0f0f8"
              />
            </View>

            <View style={styles.conditionSection}>
              <Text style={styles.sectionLabel}>Condition</Text>
              <View style={styles.conditionRow}>
                {CONDITIONS.map((c) => (
                  <Pressable
                    key={c}
                    style={[styles.condBtn, condition === c && styles.condBtnActive]}
                    onPress={() => setCondition(c)}
                  >
                    <Text style={[styles.condBtnText, condition === c && styles.condBtnTextActive]}>{c}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {candidates.length > 1 && (
              <View style={styles.altSection}>
                <Text style={styles.sectionLabel}>Alternate Matches</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {candidates.map((c: ScryfallCard, i: number) => (
                    <Pressable
                      key={c.id}
                      style={[styles.altCard, i === selectedIndex && styles.altCardActive]}
                      onPress={() => setSelectedIndex(i)}
                    >
                      <Text style={[styles.altCardName, i === selectedIndex && styles.altCardNameActive]} numberOfLines={2}>
                        {c.name}
                      </Text>
                      <Text style={styles.altCardSet}>{c.set.toUpperCase()}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.cancelBtn} onPress={() => router.back()} disabled={saving}>
          <Text style={styles.cancelBtnText}>← Back</Text>
        </Pressable>
        <Pressable
          style={[styles.confirmBtn, (!card || saving) && styles.btnDisabled]}
          onPress={handleConfirm}
          disabled={!card || saving}
        >
          {saving
            ? <ActivityIndicator color="#0a0a0f" size="small" />
            : <Text style={styles.confirmBtnText}>✓ Add to Collection</Text>
          }
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0f" },
  content: { padding: 20, paddingBottom: 150 },
  searchSection: { width: "100%", marginBottom: 20, zIndex: 10 },
  searchBar: { flexDirection: "row", alignItems: "center", backgroundColor: "#12121a", borderRadius: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: "#222233" },
  searchInput: { flex: 1, color: "#f0f0f8", fontSize: 16, paddingVertical: 12 },
  suggestions: { backgroundColor: "#12121a", borderRadius: 12, marginTop: 4, borderWidth: 1, borderColor: "#222233", overflow: "hidden" },
  suggestionItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: "#1a1a26" },
  suggestionText: { color: "#f0f0f8", fontSize: 15 },
  imageWrapper: { alignItems: "center", marginBottom: 20 },
  cardImage: { width: 240, height: 335, borderRadius: 12 },
  noCardBox: { alignItems: "center", padding: 48 },
  noCardEmoji: { fontSize: 48, marginBottom: 12 },
  noCardText: { color: "#f0f0f8", fontSize: 20, fontWeight: "700", marginBottom: 6 },
  noCardSub: { color: "#a0a0b8", fontSize: 14 },
  cardName: { color: "#f0f0f8", fontSize: 26, fontWeight: "900", textAlign: "center", marginBottom: 8 },
  metaRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, marginBottom: 20, flexWrap: "wrap" },
  rarity: { fontSize: 13, fontWeight: "700" },
  metaDot: { color: "#3a3a4a" },
  setCode: { color: "#a0a0b8", fontSize: 13 },
  setName: { color: "#606078", fontSize: 12 },
  priceRow: { flexDirection: "row", backgroundColor: "#12121a", borderRadius: 16, marginBottom: 20, borderWidth: 1, borderColor: "#222233", overflow: "hidden" },
  priceBlock: { flex: 1, alignItems: "center", paddingVertical: 16 },
  priceDivider: { width: 1, backgroundColor: "#222233" },
  priceLabel: { color: "#606078", fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  priceValue: { fontSize: 18, fontWeight: "800" },
  settingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#12121a", borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "#222233" },
  settingLabel: { color: "#f0f0f8", fontSize: 15, fontWeight: "600" },
  conditionSection: { marginBottom: 20 },
  sectionLabel: { color: "#a0a0b8", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 },
  conditionRow: { flexDirection: "row", gap: 8 },
  condBtn: { flex: 1, backgroundColor: "#12121a", borderRadius: 10, paddingVertical: 10, alignItems: "center", borderWidth: 1, borderColor: "#222233" },
  condBtnActive: { backgroundColor: "#1e1a0f", borderColor: "#c89b3c" },
  condBtnText: { color: "#a0a0b8", fontWeight: "700", fontSize: 13 },
  condBtnTextActive: { color: "#c89b3c" },
  altSection: { marginBottom: 16 },
  altCard: { backgroundColor: "#12121a", borderRadius: 10, padding: 12, marginRight: 8, width: 120, borderWidth: 1, borderColor: "#222233" },
  altCardActive: { borderColor: "#4a9eff", backgroundColor: "#0a1020" },
  altCardName: { color: "#a0a0b8", fontSize: 12, fontWeight: "600", marginBottom: 4 },
  altCardNameActive: { color: "#4a9eff" },
  altCardSet: { color: "#606078", fontSize: 11 },
  footer: { position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", gap: 12, padding: 20, paddingBottom: 36, backgroundColor: "#0a0a0f", borderTopWidth: 1, borderColor: "#222233" },
  cancelBtn: { backgroundColor: "#12121a", borderRadius: 14, paddingVertical: 16, paddingHorizontal: 20, borderWidth: 1, borderColor: "#222233" },
  cancelBtnText: { color: "#a0a0b8", fontWeight: "700" },
  confirmBtn: { flex: 1, backgroundColor: "#c89b3c", borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  confirmBtnText: { color: "#0a0a0f", fontWeight: "900", fontSize: 16 },
  btnDisabled: { opacity: 0.4 },
});
