import { useState, useEffect, useCallback } from "react";
import {
  View, Text, FlatList, Pressable, Image,
  ImageBackground, StyleSheet, Alert, ActivityIndicator, TextInput,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { supabase } from "@/lib/supabase";
import type { DbDeck } from "@/lib/supabase";
import { routes } from "@/navigation/routes";

type DeckListRow = DbDeck & { deck_cards?: { count: number }[] | null };

export default function DecksScreen() {
  const [decks, setDecks] = useState<DeckListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFormat, setNewFormat] = useState("Draft");

  const loadDecks = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("decks")
        .select("*, deck_cards(count)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setDecks(data || []);
    } catch (e: any) {
      console.error("Failed to load decks:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadDecks(); }, [loadDecks]));

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await supabase
        .from("decks")
        .insert({ name, format: newFormat, user_id: user.id })
        .select()
        .single();
      if (error) throw error;
      setCreating(false);
      setNewName("");
      setNewFormat("Draft");
      router.push(routes.deckDetail(data.id));
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "Could not create deck.");
    }
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = typeof window !== "undefined"
      ? window.confirm(`Delete "${name}"?`)
      : await new Promise<boolean>(res =>
          Alert.alert("Delete Deck", `Delete "${name}"?`, [
            { text: "Cancel", onPress: () => res(false), style: "cancel" },
            { text: "Delete", onPress: () => res(true), style: "destructive" },
          ])
        );
    if (!ok) return;
    await supabase.from("deck_cards").delete().eq("deck_id", id);
    await supabase.from("decks").delete().eq("id", id);
    loadDecks();
  };

  const FORMATS = ["Draft", "Commander", "Standard", "Modern", "Pioneer", "Legacy"];

  return (
    <View style={S.container}>
      {/* Header */}
      <ImageBackground
        source={require("../../../assets/bg-planeswalkers.jpg")}
        style={S.header}
        resizeMode="cover"
        imageStyle={{ opacity: 0.28 }}
      >
        <View style={S.headerOverlay}>
          <Text style={S.headerTitle}>🃏 Deck Vault</Text>
          <Text style={S.headerSub}>Your draft &amp; constructed decks</Text>
        </View>
      </ImageBackground>

      {/* New Deck panel */}
      {creating ? (
        <View style={S.createPanel}>
          <Text style={S.createLabel}>DECK NAME</Text>
          <TextInput
            style={S.createInput}
            value={newName}
            onChangeText={setNewName}
            placeholder="e.g. Gruul Stompy"
            placeholderTextColor="#606078"
            autoFocus
            returnKeyType="done"
          />
          <Text style={[S.createLabel, { marginTop: 12 }]}>FORMAT</Text>
          <View style={S.formatRow}>
            {FORMATS.map(f => (
              <Pressable
                key={f}
                style={[S.formatChip, newFormat === f && S.formatChipActive]}
                onPress={() => setNewFormat(f)}
              >
                <Text style={[S.formatChipText, newFormat === f && S.formatChipTextActive]}>{f}</Text>
              </Pressable>
            ))}
          </View>
          <View style={S.createActions}>
            <Pressable style={S.cancelBtn} onPress={() => setCreating(false)}>
              <Text style={S.cancelBtnText}>Cancel</Text>
            </Pressable>
            <Pressable style={S.confirmBtn} onPress={handleCreate}>
              <Text style={S.confirmBtnText}>Create Deck →</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable style={S.newDeckBtn} onPress={() => setCreating(true)}>
          <Text style={S.newDeckBtnText}>＋  New Deck</Text>
        </Pressable>
      )}

      {/* List */}
      {loading ? (
        <ActivityIndicator color="#c89b3c" style={{ marginTop: 40 }} />
      ) : decks.length === 0 ? (
        <View style={S.empty}>
          <Text style={S.emptyEmoji}>📚</Text>
          <Text style={S.emptyTitle}>No decks yet</Text>
          <Text style={S.emptySub}>Create your first deck to start building!</Text>
        </View>
      ) : (
        <FlatList
          data={decks}
          keyExtractor={d => d.id}
          contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
          renderItem={({ item: deck }) => {
            const cardCount = deck.deck_cards?.[0]?.count ?? deck.card_count ?? 0;
            return (
              <Pressable
                style={S.deckCard}
                onPress={() => router.push(routes.deckDetail(deck.id))}
              >
                <View style={S.deckLeft}>
                  <View style={S.deckIconBg}>
                    <Text style={S.deckIcon}>🃏</Text>
                  </View>
                  <View style={S.deckMeta}>
                    <Text style={S.deckName} numberOfLines={1}>{deck.name}</Text>
                    <Text style={S.deckSub}>
                      {deck.format ?? "Draft"}  ·  {deck.created_at ? new Date(deck.created_at).toLocaleDateString() : "—"}
                    </Text>
                  </View>
                </View>
                <View style={S.deckRight}>
                  <Text style={S.deckCount}>{cardCount}</Text>
                  <Text style={S.deckCountLabel}>cards</Text>
                  <Pressable
                    style={S.deckDeleteBtn}
                    onPress={() => handleDelete(deck.id, deck.name)}
                    hitSlop={8}
                  >
                    <Text style={S.deckDeleteText}>🗑️</Text>
                  </Pressable>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const S = StyleSheet.create({
  container:    { flex: 1, backgroundColor: "#0a0a0f" },
  header:       { height: 160, width: "100%" },
  headerOverlay:{ flex: 1, backgroundColor: "rgba(5,5,12,0.65)", alignItems: "center", justifyContent: "center" },
  headerTitle:  { color: "#f0f0f8", fontSize: 26, fontWeight: "900", letterSpacing: 1 },
  headerSub:    { color: "#c89b3c", fontSize: 13, fontWeight: "600", marginTop: 6 },

  newDeckBtn:     { margin: 14, backgroundColor: "#c89b3c", borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  newDeckBtnText: { color: "#0a0a0f", fontWeight: "900", fontSize: 15, letterSpacing: 0.5 },

  createPanel:   { margin: 14, backgroundColor: "#12121a", borderRadius: 16, padding: 18, borderWidth: 1, borderColor: "#222233" },
  createLabel:   { color: "#c89b3c", fontSize: 10, fontWeight: "700", letterSpacing: 1.5, marginBottom: 8 },
  createInput:   { backgroundColor: "#1a1a26", borderRadius: 10, padding: 14, color: "#f0f0f8", fontSize: 15, borderWidth: 1, borderColor: "#333344" },
  formatRow:     { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  formatChip:    { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: "#1a1a26", borderWidth: 1, borderColor: "#333344" },
  formatChipActive: { borderColor: "#c89b3c", backgroundColor: "#1e1a0f" },
  formatChipText:   { color: "#a0a0b8", fontSize: 12, fontWeight: "600" },
  formatChipTextActive: { color: "#c89b3c" },
  createActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  cancelBtn:     { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: "#333344", alignItems: "center" },
  cancelBtnText: { color: "#606078", fontWeight: "700" },
  confirmBtn:    { flex: 2, paddingVertical: 12, borderRadius: 10, backgroundColor: "#c89b3c", alignItems: "center" },
  confirmBtnText:{ color: "#0a0a0f", fontWeight: "900", fontSize: 15 },

  empty:         { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  emptyEmoji:    { fontSize: 48, marginBottom: 12 },
  emptyTitle:    { color: "#f0f0f8", fontSize: 18, fontWeight: "700", marginBottom: 8 },
  emptySub:      { color: "#a0a0b8", fontSize: 14, textAlign: "center" },

  deckCard:      { flexDirection: "row", alignItems: "center", backgroundColor: "#12121a", borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#222233" },
  deckLeft:      { flex: 1, flexDirection: "row", alignItems: "center" },
  deckIconBg:    { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(200,155,60,0.12)", alignItems: "center", justifyContent: "center", marginRight: 12 },
  deckIcon:      { fontSize: 22 },
  deckMeta:      { flex: 1 },
  deckName:      { color: "#f0f0f8", fontSize: 16, fontWeight: "700", marginBottom: 3 },
  deckSub:       { color: "#606078", fontSize: 12 },
  deckRight:     { alignItems: "center", marginLeft: 12 },
  deckCount:     { color: "#c89b3c", fontSize: 22, fontWeight: "900" },
  deckCountLabel:{ color: "#606078", fontSize: 10, fontWeight: "600" },
  deckDeleteBtn: { marginTop: 6, padding: 4 },
  deckDeleteText:{ fontSize: 16 },
});