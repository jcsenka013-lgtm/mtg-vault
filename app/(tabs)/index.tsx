import { useState, useCallback } from "react";
import {
  View, Text, ScrollView, Pressable,
  TextInput, ActivityIndicator, StyleSheet, Alert, ImageBackground, Image,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAppStore } from "@store/appStore";
import { useAuthStore } from "@store/authStore";
import { getAllSessions, calculateSessionROI, updateSessionCost, deleteSession } from "@db/queries";
import type { DbSession } from "@/lib/supabase";
import { supabase } from "@/lib/supabase";
import type { SessionROI } from "@mtgtypes/index";
import { themes, ManaTheme } from "@/theme";

const MANA: { emoji: string; theme: ManaTheme }[] = [
  { emoji: "☀️", theme: "W" },
  { emoji: "💧", theme: "U" },
  { emoji: "💀", theme: "B" },
  { emoji: "🔥", theme: "R" },
  { emoji: "🌿", theme: "G" },
  { emoji: "◇", theme: "C" },
];

const RARITY_COLORS: Record<string, string> = {
  mythic: "#e87a3c",
  rare: "#e8c060",
  uncommon: "#8ab4c4",
  common: "#a0a0b0",
};

export default function DashboardScreen() {
  const { activeSession, setActiveSession, updateSessionCost: updateStoreCost, activeTheme, setTheme } = useAppStore();
  const { signOut } = useAuthStore();
  const t = themes[activeTheme];
  const [sessions, setSessions] = useState<DbSession[]>([]);
  // ... rest of state
  const [roi, setRoi] = useState<SessionROI | null>(null);
  const [costInput, setCostInput] = useState("");
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    // ... load data logic
    setLoading(true);
    try {
      const allSessions = await getAllSessions();
      setSessions(allSessions);
      if (activeSession) {
        const roiData = await calculateSessionROI(activeSession.id);
        setRoi(roiData);
        setCostInput(activeSession.costPaid > 0 ? String(activeSession.costPaid) : "");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [activeSession]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const handleDeleteSession = async (id: string, name: string) => {
    const confirmed =
      typeof window !== "undefined"
        ? window.confirm(`Delete "${name}"? This will remove all cards in this opening.`)
        : await new Promise<boolean>(resolve =>
          Alert.alert(
            "Delete Opening",
            `Delete "${name}"? This will remove all cards in this opening.`,
            [
              { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
              { text: "Delete", style: "destructive", onPress: () => resolve(true) },
            ]
          )
        );
    if (!confirmed) return;
    await deleteSession(id);
    if (activeSession?.id === id) setActiveSession(null);
    loadData();
  };

  const handleCostUpdate = async () => {
    // ... handle cost update logic
    if (!activeSession) return;
    const cost = parseFloat(costInput);
    if (isNaN(cost) || cost < 0) return;
    await updateSessionCost(activeSession.id, cost);
    updateStoreCost(cost);
    loadData();
  };

  const profit = roi ? roi.profitLoss : 0;
  const isProfit = profit >= 0;
  const foilCount = roi ? roi.topCards.filter((c) => c.isFoil).length : 0;

  return (
    <ScrollView style={[styles.container, { backgroundColor: t.background }]} contentContainerStyle={styles.content}>

      {/* Hero Banner */}
      <ImageBackground
        source={require("../../assets/bg-mana-symbols.jpg")}
        style={styles.heroBanner}
        resizeMode="cover"
        imageStyle={{ borderRadius: 16 }}
      >
        <View style={styles.heroOverlay}>
          <Text style={styles.heroTitle}>⚔️ The Vault</Text>
          <Text style={styles.heroSubtitle}>Your MTG Collection Hub</Text>
        </View>
      </ImageBackground>

      {/* Top Banner with Logout */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <View style={styles.manaBanner}>
          {MANA.map((m) => {
            const isActive = activeTheme === m.theme;
            return (
              <Pressable
                key={m.theme}
                style={[
                  styles.manaOrb,
                  { backgroundColor: isActive ? t.surface : "#1a1a26", borderColor: isActive ? t.primary : "#2a2a3a" }
                ]}
                onPress={() => {
                  setTheme(m.theme);
                  supabase.auth.updateUser({ data: { mana_type: m.theme } });
                }}
              >
                <Text style={styles.manaEmoji}>{m.emoji}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable onPress={() => signOut()} style={{ padding: 8 }}>
          <Text style={{ color: "#ef4444", fontSize: 13, fontWeight: "600" }}>🚪 Sign Out</Text>
        </Pressable>
      </View>

      {/* Opening Picker */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Current Opening</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable style={styles.newButton} onPress={() => router.push("/manual-entry")}>
            <Text style={styles.newButtonText}>✏️ Individual Entry</Text>
          </Pressable>
          <Pressable style={styles.newButton} onPress={() => router.push("/session/new")}>
            <Text style={styles.newButtonText}>⚔️ New Opening</Text>
          </Pressable>
        </View>
      </View>

      {sessions.length === 0 ? (
        <ImageBackground
          source={require("../../assets/bg-dark-city.jpg")}
          style={styles.emptyCard}
          resizeMode="cover"
          imageStyle={{ borderRadius: 16, opacity: 0.45 }}
        >
          <Text style={styles.emptyEmoji}>🐉</Text>
          <Text style={styles.emptyTitle}>Your vault awaits, Planeswalker</Text>
          <Text style={styles.emptySubtitle}>
            Crack open a pack to begin cataloging your collection
          </Text>
          <Pressable style={styles.ctaButton} onPress={() => router.push("/session/new")}>
            <Text style={styles.ctaText}>Begin Your Journey</Text>
          </Pressable>
        </ImageBackground>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sessionScroll}>
          {sessions.map((s) => (
            <View key={s.id} style={[styles.sessionChip, activeSession?.id === s.id && styles.sessionChipActive]}>
              <Pressable
                style={{ flex: 1 }}
                onPress={() => setActiveSession({ id: s.id, name: s.name, costPaid: s.cost_paid })}
              >
                <Text style={[styles.sessionChipText, activeSession?.id === s.id && styles.sessionChipTextActive]}>
                  {s.name}
                </Text>
              </Pressable>
              <Pressable
                style={styles.sessionChipDelete}
                onPress={() => handleDeleteSession(s.id, s.name)}
                hitSlop={6}
              >
                <Text style={styles.sessionChipDeleteText}>×</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      {activeSession && roi && (
        <>
          {/* Collection Summary */}
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{roi.totalCards}</Text>
                <Text style={styles.summaryLabel}>Cards</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: RARITY_COLORS.mythic }]}>
                  {roi.byRarity.mythic.count}
                </Text>
                <Text style={styles.summaryLabel}>Mythics</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: RARITY_COLORS.rare }]}>
                  {roi.byRarity.rare.count}
                </Text>
                <Text style={styles.summaryLabel}>Rares</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: "#b8a0f0" }]}>{foilCount}</Text>
                <Text style={styles.summaryLabel}>✨ Foils</Text>
              </View>
            </View>
          </View>

          {/* Rarity Breakdown */}
          <Text style={styles.sectionTitle}>◆ By Rarity</Text>
          <View style={styles.rarityGrid}>
            {(["mythic", "rare", "uncommon", "common"] as const).map((rarity) => {
              const data = roi.byRarity[rarity];
              const color = RARITY_COLORS[rarity];
              return (
                <View key={rarity} style={[styles.rarityCard, { borderTopColor: color }]}>
                  <Text style={[styles.rarityDiamond, { color }]}>◆</Text>
                  <Text style={[styles.rarityName, { color }]}>
                    {rarity.charAt(0).toUpperCase() + rarity.slice(1)}
                  </Text>
                  <Text style={styles.rarityCount}>{data.count}</Text>
                  <Text style={styles.rarityValue}>${data.value.toFixed(2)}</Text>
                </View>
              );
            })}
          </View>

          {/* Highlight Cards */}
          {roi.topCards.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { marginTop: 20 }]}>✨ Highlight Cards</Text>
              {roi.topCards.slice(0, 5).map((card) => {
                const price = card.isFoil
                  ? (card.priceUsdFoil ?? card.priceUsd ?? 0)
                  : (card.priceUsd ?? 0);
                return (
                  <Pressable
                    key={card.id}
                    style={styles.topCardRow}
                    onPress={() => router.push(`/card/${card.id}`)}
                  >
                    <Text style={[styles.cardDiamond, { color: RARITY_COLORS[card.rarity] }]}>◆</Text>
                    <View style={styles.topCardInfo}>
                      <Text style={styles.topCardName}>{card.name}</Text>
                      <Text style={styles.topCardSet}>
                        {card.setCode.toUpperCase()} · {card.isFoil ? "✨ Foil" : card.condition}
                      </Text>
                    </View>
                    <Text style={styles.topCardPrice}>${price.toFixed(2)}</Text>
                  </Pressable>
                );
              })}
            </>
          )}

          {/* Opening Value — financial summary */}
          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>📜 Opening Value</Text>
          <View style={styles.roiRow}>
            <View style={[styles.roiCard, styles.roiCardHalf]}>
              <Text style={styles.roiLabel}>Opened For</Text>
              <TextInput
                style={styles.costInput}
                value={costInput}
                onChangeText={setCostInput}
                onBlur={handleCostUpdate}
                onSubmitEditing={handleCostUpdate}
                keyboardType="decimal-pad"
                placeholder="$0.00"
                placeholderTextColor="#606078"
              />
            </View>
            <View style={[styles.roiCard, styles.roiCardHalf]}>
              <Text style={styles.roiLabel}>Collection Worth</Text>
              <Text style={styles.roiValue}>${roi.totalValue.toFixed(2)}</Text>
            </View>
          </View>

          <View style={[styles.plCard, isProfit ? styles.profitBg : styles.lossBg]}>
            <Text style={styles.plLabel}>{isProfit ? "⬆️ RETURN" : "⬇️ UNDER VALUE"}</Text>
            <Text style={[styles.plValue, isProfit ? styles.profitText : styles.lossText]}>
              {isProfit ? "+" : ""}${Math.abs(profit).toFixed(2)}
            </Text>
            <Text style={[styles.plPercent, isProfit ? styles.profitText : styles.lossText]}>
              {isProfit ? "+" : ""}{roi.profitPercent.toFixed(1)}%
            </Text>
            <Text style={styles.plCards}>{roi.totalCards} cards cataloged</Text>
          </View>
        </>
      )}

      {loading && <ActivityIndicator color="#c89b3c" style={{ marginTop: 40 }} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0f" },
  content: { padding: 16, paddingBottom: 40 },

  // Hero Banner
  heroBanner: { height: 160, borderRadius: 16, marginBottom: 20, overflow: "hidden" },
  heroOverlay: { flex: 1, backgroundColor: "rgba(10,10,15,0.55)", borderRadius: 16, alignItems: "center", justifyContent: "center" },
  heroTitle: { color: "#f0f0f8", fontSize: 28, fontWeight: "900", letterSpacing: 2, textShadowColor: "rgba(0,0,0,0.9)", textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 },
  heroSubtitle: { color: "#c89b3c", fontSize: 13, fontWeight: "700", letterSpacing: 1, marginTop: 6, textShadowColor: "rgba(0,0,0,0.9)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },

  // Mana Banner
  manaBanner: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    marginBottom: 20,
    marginTop: 4,
  },
  manaOrb: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1a1a26",
    borderWidth: 1,
    borderColor: "#2a2a3a",
    alignItems: "center",
    justifyContent: "center",
  },
  manaEmoji: { fontSize: 18 },

  // Section Headers
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  sectionTitle: { color: "#a0a0b8", fontSize: 13, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 },

  // Buttons
  newButton: { backgroundColor: "#1a1a26", paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: "#c89b3c" },
  newButtonText: { color: "#c89b3c", fontSize: 13, fontWeight: "700" },

  // Empty State
  emptyCard: { backgroundColor: "#12121a", borderRadius: 16, padding: 32, alignItems: "center", marginTop: 20, borderWidth: 1, borderColor: "#2a1f0a" },
  emptyEmoji: { fontSize: 56, marginBottom: 14 },
  emptyTitle: { color: "#f0f0f8", fontSize: 20, fontWeight: "700", marginBottom: 8, textAlign: "center" },
  emptySubtitle: { color: "#a0a0b8", fontSize: 14, marginBottom: 24, textAlign: "center", lineHeight: 20 },
  ctaButton: { backgroundColor: "#c89b3c", borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  ctaText: { color: "#0a0a0f", fontWeight: "800", fontSize: 15 },

  // Session Chips
  sessionScroll: { marginBottom: 20 },
  sessionChip: { flexDirection: "row", alignItems: "center", backgroundColor: "#1a1a26", borderRadius: 20, paddingLeft: 16, paddingRight: 6, paddingVertical: 8, marginRight: 8, borderWidth: 1, borderColor: "#222233", gap: 6 },
  sessionChipActive: { borderColor: "#c89b3c", backgroundColor: "#1e1a0f" },
  sessionChipText: { color: "#a0a0b8", fontWeight: "600" },
  sessionChipTextActive: { color: "#c89b3c" },
  sessionChipDelete: { backgroundColor: "rgba(239,68,68,0.15)", borderRadius: 12, width: 22, height: 22, alignItems: "center", justifyContent: "center" },
  sessionChipDeleteText: { color: "#ef4444", fontSize: 16, fontWeight: "700", lineHeight: 20 },

  // Collection Summary Card
  summaryCard: {
    backgroundColor: "#12121a",
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#222233",
  },
  summaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-around" },
  summaryItem: { alignItems: "center", flex: 1 },
  summaryValue: { color: "#f0f0f8", fontSize: 28, fontWeight: "800", marginBottom: 4 },
  summaryLabel: { color: "#606078", fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  summaryDivider: { width: 1, height: 40, backgroundColor: "#222233" },

  // Rarity Grid
  rarityGrid: { flexDirection: "row", gap: 8, marginBottom: 4 },
  rarityCard: {
    flex: 1,
    backgroundColor: "#12121a",
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#222233",
    borderTopWidth: 3,
  },
  rarityDiamond: { fontSize: 14, marginBottom: 2 },
  rarityName: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  rarityCount: { color: "#f0f0f8", fontSize: 20, fontWeight: "800" },
  rarityValue: { color: "#a0a0b8", fontSize: 11, marginTop: 2 },

  // Top Cards
  topCardRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#12121a", borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: "#222233" },
  cardDiamond: { fontSize: 14, marginRight: 12 },
  topCardInfo: { flex: 1 },
  topCardName: { color: "#f0f0f8", fontWeight: "700", fontSize: 15 },
  topCardSet: { color: "#606078", fontSize: 12, marginTop: 2 },
  topCardPrice: { color: "#22c55e", fontWeight: "800", fontSize: 16 },

  // Financial
  roiRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  roiCard: { backgroundColor: "#12121a", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#222233" },
  roiCardHalf: { flex: 1 },
  roiLabel: { color: "#606078", fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  roiValue: { color: "#f0f0f8", fontSize: 24, fontWeight: "800" },
  costInput: { color: "#f0f0f8", fontSize: 24, fontWeight: "800", padding: 0 },

  plCard: { borderRadius: 16, padding: 20, alignItems: "center", marginBottom: 8, borderWidth: 1, borderColor: "#222233" },
  profitBg: { backgroundColor: "#0a1a0f" },
  lossBg: { backgroundColor: "#1a0a0a" },
  plLabel: { color: "#a0a0b8", fontSize: 12, fontWeight: "700", letterSpacing: 1.5, marginBottom: 8 },
  plValue: { fontSize: 40, fontWeight: "900", marginBottom: 4 },
  plPercent: { fontSize: 20, fontWeight: "700", marginBottom: 8, opacity: 0.8 },
  plCards: { color: "#606078", fontSize: 13 },
  profitText: { color: "#22c55e" },
  lossText: { color: "#ef4444" },
});
