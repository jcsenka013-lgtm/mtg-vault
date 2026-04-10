import { useState, useCallback } from "react";
import {
  View, Text, ScrollView, Pressable, Image,
  ActivityIndicator, StyleSheet, ImageBackground,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { useAuthStore } from "@store/authStore";
import { getAllCards } from "@db/queries";
import type { DbCard } from "@/lib/supabase";
import { useLeaderboard } from "@/hooks/useLeaderboard";

const RARITY_DOT: Record<string, string> = {
  mythic: "#e87a3c",
  rare: "#e8c060",
  uncommon: "#8ab4c4",
  common: "#a0a0b0",
};

const MANA_COLOR_BG: Record<string, string> = {
  W: "#c8b84a",
  U: "#3a7ac0",
  B: "#7a50a0",
  R: "#c04020",
  G: "#207a40",
};

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuthStore();
  const [cards, setCards] = useState<DbCard[]>([]);
  const [loading, setLoading] = useState(false);
  const { leaderboard, activeSeason } = useLeaderboard();

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const allCards = await getAllCards();
      setCards(allCards);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadDashboard(); }, [loadDashboard]));

  // Triage vault value
  let lgsValue = 0;
  let ebayValue = 0;
  cards.forEach(card => {
    const price = card.is_foil
      ? (card.price_usd_foil ?? card.price_usd ?? 0)
      : (card.price_usd ?? 0);
    const total = price * card.quantity;
    if (card.destination === "LGS") lgsValue += total;
    else if (card.destination === "BULK") ebayValue += total;
    else if (price >= 2.0) lgsValue += total;
    else ebayValue += total;
  });
  const totalVault = lgsValue + ebayValue;

  // Player identity
  const firstName =
    user?.user_metadata?.display_name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    "Planeswalker";

  const rankIdx = leaderboard.findIndex(
    p => p.player_name.toLowerCase() === firstName.toLowerCase()
  );
  const myStats = rankIdx !== -1 ? leaderboard[rankIdx] : null;

  const QUICK_ACTIONS = [
    { emoji: "📷", label: "Scan Cards",    sub: "Digitize stack",    route: "/scanner",   accent: "#4a9eff" },
    { emoji: "📦", label: "Manage Vault",  sub: "Inventory triage",  route: "/inventory", accent: "#c89b3c" },
    { emoji: "⚔️", label: "Report Match",  sub: "Log season result", route: "/compete",   accent: "#ef4444" },
    { emoji: "🃏", label: "Deck Builder",  sub: "Draft & construct", route: "/decks",     accent: "#9d4edd" },
  ];

  return (
    <ImageBackground
      source={require("../../assets/bg-lava-tree.jpeg")}
      style={S.bg}
      resizeMode="cover"
    >
      <View style={S.overlay} />

      <ScrollView
        style={S.scroll}
        contentContainerStyle={[S.content, { paddingTop: Math.max(insets.top, 20) }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <View style={S.headerRow}>
          <View style={S.headerText}>
            <Text style={S.eyebrow}>COMMAND CENTER</Text>
            <Text style={S.greeting}>
              Welcome back,{" "}
              <Text style={S.greetingAccent}>{firstName}</Text>
            </Text>
          </View>
          <Pressable style={S.signOutBtn} onPress={() => signOut()}>
            <Text style={S.signOutText}>🚪 Out</Text>
          </Pressable>
        </View>

        {/* ── Vault Summary Card ───────────────────────────────────────────── */}
        <View style={S.vaultCard}>
          <Text style={S.vaultEyebrow}>TOTAL VAULT VALUE</Text>
          <Text style={S.vaultTotal}>${totalVault.toFixed(2)}</Text>
          <View style={S.vaultDivider} />
          <View style={S.vaultBreakdown}>
            <View style={S.vaultSplit}>
              <View style={[S.vaultDot, { backgroundColor: "#c89b3c" }]} />
              <Text style={S.vaultSplitLabel}>LGS Credit</Text>
              <Text style={S.vaultSplitValue}>${lgsValue.toFixed(2)}</Text>
            </View>
            <View style={S.vaultDividerV} />
            <View style={S.vaultSplit}>
              <View style={[S.vaultDot, { backgroundColor: "#606078" }]} />
              <Text style={S.vaultSplitLabel}>eBay Bulk</Text>
              <Text style={S.vaultSplitValue}>${ebayValue.toFixed(2)}</Text>
            </View>
          </View>
        </View>

        {/* ── Live Season Widget ───────────────────────────────────────────── */}
        {activeSeason && (
          <View style={S.seasonCard}>
            <View style={S.seasonHeader}>
              <View style={S.seasonLeft}>
                <View style={S.liveRow}>
                  <View style={S.liveDot} />
                  <Text style={S.liveLabel}>LIVE SEASON</Text>
                </View>
                <Text style={S.seasonTitle} numberOfLines={1}>{activeSeason.title}</Text>
              </View>
              {myStats && (
                <View style={S.recordPill}>
                  <Text style={S.recordText}>{myStats.wins}W  –  {myStats.losses}L</Text>
                </View>
              )}
            </View>

            <View style={S.standingRow}>
              {myStats ? (
                <>
                  <View style={S.standingLeft}>
                    <Text style={S.standingEyebrow}>Your Standing</Text>
                    <Text style={S.standingRank}>
                      {rankIdx === 0
                        ? "🏆 1st Place"
                        : `Rank #${rankIdx + 1}`}
                    </Text>
                  </View>
                  <View style={S.colorPips}>
                    {myStats.deck_colors.map((c, i) => (
                      <View
                        key={i}
                        style={[S.pip, { backgroundColor: MANA_COLOR_BG[c] ?? "#333" }]}
                      >
                        <Text style={S.pipText}>{c}</Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : (
                <Text style={S.noMatches}>
                  You haven't played any matches in this season yet.
                </Text>
              )}
            </View>
          </View>
        )}

        {/* ── Quick Action Grid ─────────────────────────────────────────────── */}
        <Text style={S.sectionLabel}>QUICK ACTIONS</Text>
        <View style={S.gridRow}>
          {QUICK_ACTIONS.slice(0, 2).map(a => (
            <Pressable
              key={a.label}
              style={S.actionCard}
              onPress={() => router.push(a.route as any)}
            >
              <View style={[S.actionIconBg, { backgroundColor: a.accent + "22" }]}>
                <Text style={S.actionEmoji}>{a.emoji}</Text>
              </View>
              <Text style={S.actionLabel}>{a.label}</Text>
              <Text style={S.actionSub}>{a.sub}</Text>
            </Pressable>
          ))}
        </View>
        <View style={[S.gridRow, { marginBottom: 28 }]}>
          {QUICK_ACTIONS.slice(2, 4).map(a => (
            <Pressable
              key={a.label}
              style={S.actionCard}
              onPress={() => router.push(a.route as any)}
            >
              <View style={[S.actionIconBg, { backgroundColor: a.accent + "22" }]}>
                <Text style={S.actionEmoji}>{a.emoji}</Text>
              </View>
              <Text style={S.actionLabel}>{a.label}</Text>
              <Text style={S.actionSub}>{a.sub}</Text>
            </Pressable>
          ))}
        </View>

        {/* ── Recent Scans Feed ─────────────────────────────────────────────── */}
        <Text style={S.sectionLabel}>RECENT SCANS</Text>
        {loading ? (
          <ActivityIndicator color="#c89b3c" style={{ marginTop: 12 }} />
        ) : cards.length > 0 ? (
          <View style={S.feedCard}>
            {cards.slice(0, 4).map((c, i) => {
              const price = c.is_foil
                ? (c.price_usd_foil ?? c.price_usd)
                : c.price_usd;
              const isLast = i === Math.min(cards.length, 4) - 1;
              return (
                <Pressable
                  key={c.id}
                  style={[S.feedRow, !isLast && S.feedRowBorder]}
                  onPress={() => router.push(`/card/${c.id}` as any)}
                >
                  {c.image_uri ? (
                    <Image source={{ uri: c.image_uri }} style={S.feedThumb} />
                  ) : (
                    <View style={[S.feedThumb, S.feedThumbBlank]}>
                      <Text>🃏</Text>
                    </View>
                  )}
                  <View style={S.feedInfo}>
                    <Text style={S.feedName} numberOfLines={1}>{c.name}</Text>
                    <View style={S.feedMeta}>
                      <View style={[S.rarityDot, { backgroundColor: RARITY_DOT[c.rarity] }]} />
                      <Text style={S.feedSet}>{c.set_code.toUpperCase()}</Text>
                      {c.is_foil && <Text style={S.feedFoil}>✨</Text>}
                    </View>
                  </View>
                  <Text style={S.feedPrice}>
                    {price != null ? `$${Number(price).toFixed(2)}` : "—"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <View style={S.emptyFeed}>
            <Text style={S.emptyEmoji}>🔮</Text>
            <Text style={S.emptyText}>
              Your vault is empty. Start scanning to populate your feed.
            </Text>
          </View>
        )}
      </ScrollView>
    </ImageBackground>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const CARD   = "rgba(18,18,26,0.90)";
const BORDER = "#222233";
const GOLD   = "#c89b3c";
const DIM    = "#606078";
const SOFT   = "#a0a0b8";
const WHITE  = "#f0f0f8";

const S = StyleSheet.create({
  bg:      { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(5,5,12,0.76)" },
  scroll:  { flex: 1 },
  content: { paddingHorizontal: 18, paddingBottom: 48 },

  // Header
  headerRow:       { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 },
  headerText:      { flex: 1, marginRight: 12 },
  eyebrow:         { color: DIM, fontSize: 11, fontWeight: "700", letterSpacing: 2, marginBottom: 4 },
  greeting:        { color: WHITE, fontSize: 28, fontWeight: "900", letterSpacing: 0.5 },
  greetingAccent:  { color: GOLD },
  signOutBtn:      { backgroundColor: "rgba(239,68,68,0.12)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: "rgba(239,68,68,0.25)", marginTop: 4 },
  signOutText:     { color: "#ef4444", fontSize: 12, fontWeight: "700" },

  // Vault card
  vaultCard:       { backgroundColor: CARD, borderRadius: 24, padding: 22, borderWidth: 1, borderColor: BORDER, marginBottom: 16 },
  vaultEyebrow:    { color: DIM, fontSize: 10, fontWeight: "700", letterSpacing: 2, marginBottom: 6 },
  vaultTotal:      { color: WHITE, fontSize: 42, fontWeight: "900", letterSpacing: -1, marginBottom: 18 },
  vaultDivider:    { height: 1, backgroundColor: BORDER, marginBottom: 16 },
  vaultBreakdown:  { flexDirection: "row", alignItems: "center" },
  vaultSplit:      { flex: 1, alignItems: "center" },
  vaultDot:        { width: 8, height: 8, borderRadius: 4, marginBottom: 4 },
  vaultSplitLabel: { color: SOFT, fontSize: 11, fontWeight: "600", marginBottom: 4 },
  vaultSplitValue: { color: WHITE, fontSize: 20, fontWeight: "800" },
  vaultDividerV:   { width: 1, height: 44, backgroundColor: BORDER, marginHorizontal: 12 },

  // Season widget
  seasonCard:   { backgroundColor: CARD, borderRadius: 20, padding: 18, borderWidth: 1, borderColor: BORDER, borderLeftWidth: 4, borderLeftColor: "#9d4edd", marginBottom: 28 },
  seasonHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 },
  seasonLeft:   { flex: 1, marginRight: 12 },
  liveRow:      { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  liveDot:      { width: 8, height: 8, borderRadius: 4, backgroundColor: "#22c55e", marginRight: 6 },
  liveLabel:    { color: "#9d4edd", fontSize: 10, fontWeight: "700", letterSpacing: 1.5 },
  seasonTitle:  { color: WHITE, fontSize: 18, fontWeight: "800" },
  recordPill:   { backgroundColor: "#1a1a26", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: BORDER },
  recordText:   { color: WHITE, fontSize: 13, fontWeight: "700" },
  standingRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#12121a", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: BORDER },
  standingLeft: { flex: 1 },
  standingEyebrow: { color: DIM, fontSize: 10, fontWeight: "600", marginBottom: 2 },
  standingRank: { color: WHITE, fontSize: 16, fontWeight: "800" },
  colorPips:    { flexDirection: "row", gap: 6 },
  pip:          { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  pipText:      { color: WHITE, fontSize: 10, fontWeight: "900" },
  noMatches:    { color: DIM, fontSize: 13, fontStyle: "italic" },

  // Section label
  sectionLabel: { color: DIM, fontSize: 10, fontWeight: "700", letterSpacing: 2, marginBottom: 12 },

  // Quick actions
  gridRow:      { flexDirection: "row", gap: 12, marginBottom: 12 },
  actionCard:   { flex: 1, backgroundColor: CARD, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: BORDER },
  actionIconBg: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  actionEmoji:  { fontSize: 20 },
  actionLabel:  { color: WHITE, fontSize: 15, fontWeight: "700", marginBottom: 3 },
  actionSub:    { color: DIM, fontSize: 12 },

  // Feed
  feedCard:      { backgroundColor: CARD, borderRadius: 18, borderWidth: 1, borderColor: BORDER, overflow: "hidden", marginBottom: 8 },
  feedRow:       { flexDirection: "row", alignItems: "center", padding: 12 },
  feedRowBorder: { borderBottomWidth: 1, borderColor: BORDER },
  feedThumb:     { width: 40, height: 56, borderRadius: 6, marginRight: 12 },
  feedThumbBlank:{ backgroundColor: "#1a1a26", alignItems: "center", justifyContent: "center" },
  feedInfo:      { flex: 1 },
  feedName:      { color: WHITE, fontWeight: "700", fontSize: 14, marginBottom: 4 },
  feedMeta:      { flexDirection: "row", alignItems: "center", gap: 6 },
  rarityDot:     { width: 6, height: 6, borderRadius: 3 },
  feedSet:       { color: DIM, fontSize: 12, textTransform: "uppercase" },
  feedFoil:      { fontSize: 11 },
  feedPrice:     { color: "#22c55e", fontWeight: "800", fontSize: 15 },
  emptyFeed:     { backgroundColor: CARD, borderRadius: 18, padding: 32, alignItems: "center", borderWidth: 1, borderColor: BORDER },
  emptyEmoji:    { fontSize: 40, marginBottom: 12 },
  emptyText:     { color: SOFT, fontSize: 14, textAlign: "center", lineHeight: 20 },
});
