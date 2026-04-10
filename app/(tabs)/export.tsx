import { useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Switch,
  ImageBackground,
  Platform,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { useAppStore } from "@store/appStore";
import { getCardsForSession } from "@db/queries";
import { exportCardsAsCsv, formatAsTcgPlayerList } from "@api/export";
import * as Clipboard from "expo-clipboard";
import { supabase } from "@/lib/supabase";
import type { DbCard } from "@/lib/supabase";
import { type ManaTheme } from "@/theme";

const MANA_ORBS: { icon: string; theme: ManaTheme; bg: string }[] = [
  { icon: "☀️", theme: "W", bg: "#d4c060" },
  { icon: "💧", theme: "U", bg: "#3a7ac0" },
  { icon: "💀", theme: "B", bg: "#7a50a0" },
  { icon: "🔥", theme: "R", bg: "#c04020" },
  { icon: "🌳", theme: "G", bg: "#207a40" },
];

const RARITY_COLORS: Record<string, string> = {
  mythic: "#e87a3c",
  rare: "#e8c060",
  uncommon: "#8ab4c4",
  common: "#a0a0b0",
};

export default function ExportScreen() {
  const { activeSession, activeTheme, setTheme } = useAppStore();
  const [cards, setCards] = useState<DbCard[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [foilOnly, setFoilOnly] = useState(false);

  const loadCards = useCallback(async () => {
    if (!activeSession) return;
    setLoading(true);
    try {
      const results = await getCardsForSession(activeSession.id, {
        isFoil: foilOnly ? true : undefined,
        sortField: "price_usd",
        sortOrder: "desc",
      });
      setCards(results);
      setSelected(new Set());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [activeSession, foilOnly]);

  useFocusEffect(useCallback(() => { loadCards(); }, [loadCards]));

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(cards.map((c) => c.id)));
  const clearAll = () => setSelected(new Set());

  const selectedCards = cards.filter((c) => selected.has(c.id));
  const selectedValue = selectedCards.reduce((sum, c) => {
    const price = c.is_foil ? (c.price_usd_foil ?? c.price_usd ?? 0) : (c.price_usd ?? 0);
    return sum + Number(price) * c.quantity;
  }, 0);

  const handleExportCsv = async () => {
    if (selectedCards.length === 0) {
      const msg = "Please select at least one card to export.";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("No cards selected", msg);
      return;
    }
    setExporting(true);
    try {
      await exportCardsAsCsv(selectedCards, `mtg-export-${Date.now()}.csv`);
    } catch (e) {
      const msg = String(e);
      if (Platform.OS === "web") window.alert("Export failed: " + msg);
      else Alert.alert("Export failed", msg);
    } finally {
      setExporting(false);
    }
  };

  const handleCopyList = async () => {
    if (selectedCards.length === 0) {
      const msg = "Select at least one card first.";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("No cards selected", msg);
      return;
    }
    const text = formatAsTcgPlayerList(selectedCards);
    await Clipboard.setStringAsync(text);
    
    const successMsg = `${selectedCards.length} cards copied to clipboard in TCGplayer format.`;
    if (Platform.OS === "web") window.alert(successMsg);
    else Alert.alert("Copied!", successMsg);
  };

  const renderCard = ({ item }: { item: DbCard }) => {
    const price = item.is_foil ? (item.price_usd_foil ?? item.price_usd) : item.price_usd;
    const isSelected = selected.has(item.id);
    return (
      <Pressable
        style={[styles.cardRow, isSelected && styles.cardRowSelected]}
        onPress={() => toggleSelect(item.id)}
      >
        <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
          {isSelected && <Text style={styles.checkmark}>✓</Text>}
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
          <Text style={[styles.rarity, { color: RARITY_COLORS[item.rarity] }]}>
            {item.rarity} · {item.set_code.toUpperCase()} {item.is_foil ? "✨" : ""} · {item.condition}
          </Text>
        </View>
        <Text style={[styles.price, price && Number(price) >= 10 ? styles.highValue : null]}>
          {price !== null ? `$${Number(price).toFixed(2)}` : "—"}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      {/* Combined Hero Banner */}
      <ImageBackground
        source={require("../../assets/bg-mana-symbols.jpg")}
        style={styles.heroBanner}
        resizeMode="cover"
      >
        <View style={styles.heroBannerOverlay}>
          {/* Mana orbs — left, single row */}
          <View style={styles.manaOrbsRow}>
            {MANA_ORBS.map((m) => (
              <Pressable
                key={m.theme}
                style={[
                  styles.manaOrb,
                  { backgroundColor: m.bg, opacity: activeTheme === m.theme ? 1 : 0.55 },
                  activeTheme === m.theme && styles.manaOrbActive,
                ]}
                onPress={() => {
                  setTheme(m.theme);
                  supabase.auth.updateUser({ data: { mana_type: m.theme } });
                }}
              >
                <Text style={styles.manaOrbIcon}>{m.icon}</Text>
              </Pressable>
            ))}
          </View>
          {/* Title — center */}
          <View style={styles.heroTitleBox}>
            <Text style={styles.heroTitle}>⚡ Share</Text>
          </View>
          {/* Spacer to balance */}
          <View style={{ width: 80 }} />
        </View>
      </ImageBackground>

      <View style={styles.header}>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Foil Only</Text>
          <Switch
            value={foilOnly}
            onValueChange={setFoilOnly}
            trackColor={{ false: "#222233", true: "#4a9eff" }}
            thumbColor={foilOnly ? "#f0f0f8" : "#606078"}
          />
        </View>
        <View style={styles.selRow}>
          <Pressable style={styles.selBtn} onPress={selectAll}><Text style={styles.selBtnText}>Select All</Text></Pressable>
          <Pressable style={styles.selBtn} onPress={clearAll}><Text style={styles.selBtnText}>Clear</Text></Pressable>
        </View>
      </View>

      <View style={styles.summaryBar}>
        <Text style={styles.summaryCount}>{selected.size} selected</Text>
        <Text style={styles.summaryValue}>${selectedValue.toFixed(2)} est. value</Text>
      </View>

      {!activeSession ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>📦</Text>
          <Text style={styles.emptyText}>No active session</Text>
        </View>
      ) : loading ? (
        <ActivityIndicator color="#c89b3c" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={cards}
          keyExtractor={(c) => c.id}
          renderItem={renderCard}
          contentContainerStyle={{ paddingBottom: 180 }}
          ItemSeparatorComponent={() => <View style={styles.divider} />}
        />
      )}

      <View style={styles.actions}>
        <Pressable
          style={[styles.exportBtn, styles.csvBtn, exporting && styles.btnDisabled]}
          onPress={handleExportCsv}
          disabled={exporting}
        >
          {exporting ? <ActivityIndicator color="#0a0a0f" size="small" /> : <Text style={styles.exportBtnText}>📄 Export CSV</Text>}
        </Pressable>
        <Pressable style={[styles.exportBtn, styles.copyBtn]} onPress={handleCopyList}>
          <Text style={[styles.exportBtnText, { color: "#f0f0f8" }]}>📋 Copy TCGplayer List</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0f" },
  heroBanner: { height: 120, width: "100%", overflow: "hidden" },
  heroBannerOverlay: { flex: 1, backgroundColor: "rgba(10,10,15,0.50)", flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  manaOrbsRow: { flexDirection: "row", gap: 6, alignItems: "center" },
  manaOrb: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  manaOrbActive: { transform: [{ scale: 1.2 }] },
  manaOrbIcon: { fontSize: 18 },
  heroTitleBox: { flex: 1, alignItems: "center" },
  heroTitle: { color: "#f0f0f8", fontSize: 22, fontWeight: "900", letterSpacing: 1, textShadowColor: "rgba(0,0,0,0.9)", textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 6 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: "#222233" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  toggleLabel: { color: "#a0a0b8", fontSize: 14, fontWeight: "600" },
  selRow: { flexDirection: "row", gap: 8 },
  selBtn: { backgroundColor: "#12121a", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: "#222233" },
  selBtnText: { color: "#a0a0b8", fontSize: 13, fontWeight: "600" },
  summaryBar: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#12121a", borderBottomWidth: 1, borderColor: "#222233" },
  summaryCount: { color: "#606078", fontSize: 13 },
  summaryValue: { color: "#c89b3c", fontWeight: "700", fontSize: 13 },
  cardRow: { flexDirection: "row", alignItems: "center", padding: 14, paddingHorizontal: 16 },
  cardRowSelected: { backgroundColor: "rgba(200,155,60,0.06)" },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: "#3a3a4a", marginRight: 14, alignItems: "center", justifyContent: "center" },
  checkboxSelected: { backgroundColor: "#c89b3c", borderColor: "#c89b3c" },
  checkmark: { color: "#0a0a0f", fontWeight: "800", fontSize: 13 },
  cardInfo: { flex: 1 },
  cardName: { color: "#f0f0f8", fontWeight: "700", fontSize: 15, marginBottom: 3 },
  rarity: { fontSize: 12, fontWeight: "600" },
  price: { color: "#22c55e", fontWeight: "800", fontSize: 16 },
  highValue: { color: "#e8c060" },
  divider: { height: 1, backgroundColor: "#12121a" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { color: "#a0a0b8", fontSize: 16 },
  actions: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 16, gap: 10, backgroundColor: "#0a0a0f", borderTopWidth: 1, borderColor: "#222233", paddingBottom: 32 },
  exportBtn: { borderRadius: 14, padding: 16, alignItems: "center" },
  csvBtn: { backgroundColor: "#c89b3c" },
  copyBtn: { backgroundColor: "#1a1a26", borderWidth: 1, borderColor: "#222233" },
  btnDisabled: { opacity: 0.5 },
  exportBtnText: { color: "#0a0a0f", fontWeight: "800", fontSize: 15 },
});
