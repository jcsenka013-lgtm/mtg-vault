import { useState } from "react";
import {
  View, Text, TextInput, Pressable,
  StyleSheet, Alert, ScrollView, ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { useAppStore } from "@store/appStore";
import { createSession } from "@db/queries";

const MANA_COLORS = [
  { symbol: "☀️", color: "#f0e6a0", label: "W" },
  { symbol: "💧", color: "#7ab4e8", label: "U" },
  { symbol: "💀", color: "#9a8ab8", label: "B" },
  { symbol: "🔥", color: "#e87a3c", label: "R" },
  { symbol: "🌿", color: "#4ab870", label: "G" },
];

const PRESETS = [
  { label: "Draft Booster Box", cost: "120", symbol: "◆" },
  { label: "Set Booster Box",   cost: "130", symbol: "◆◆" },
  { label: "Collector Box",     cost: "240", symbol: "✨" },
  { label: "Single Pack",       cost: "5",   symbol: "○" },
  { label: "Bundle / Fat Pack", cost: "45",  symbol: "◇" },
];

export default function NewSessionScreen() {
  const { setActiveSession } = useAppStore();
  const [name, setName] = useState("");
  const [cost, setCost] = useState("");
  const [setCode, setSetCode] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) {
      Alert.alert("Name required", "Give your opening a name to remember it by.");
      return;
    }
    const costPaid = parseFloat(cost) || 0;
    setLoading(true);
    try {
      const session = await createSession({
        name: name.trim(),
        setCode: setCode.trim().toUpperCase() || null,
        costPaid,
      });
      setActiveSession({ id: session.id, name: session.name, costPaid: session.cost_paid });
      router.replace("/(tabs)/scanner");
    } catch (e) {
      Alert.alert("Error", "Could not create session. Please try again.");
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

      {/* Mana row */}
      <View style={styles.manaBanner}>
        {MANA_COLORS.map((m) => (
          <View key={m.label} style={[styles.manaOrb, { borderColor: m.color + "44" }]}>
            <Text style={styles.manaEmoji}>{m.symbol}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.title}>🌟 New Opening</Text>
      <Text style={styles.subtitle}>
        Name your adventure — every great collection has a story
      </Text>

      <Text style={styles.label}>Opening Name *</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Bloomburrow Box #1"
        placeholderTextColor="#606078"
        autoFocus
        returnKeyType="next"
      />

      <Text style={styles.label}>Product Type</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presets}>
        {PRESETS.map((p) => (
          <Pressable
            key={p.label}
            style={styles.preset}
            onPress={() => { if (!name) setName(p.label); setCost(p.cost); }}
          >
            <Text style={styles.presetSymbol}>{p.symbol}</Text>
            <Text style={styles.presetName}>{p.label}</Text>
            <Text style={styles.presetCost}>${p.cost}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Text style={styles.label}>Cost Paid (USD)</Text>
      <TextInput
        style={styles.input}
        value={cost}
        onChangeText={setCost}
        placeholder="$0.00"
        placeholderTextColor="#606078"
        keyboardType="decimal-pad"
        returnKeyType="next"
      />

      <Text style={styles.label}>Set Code (optional)</Text>
      <TextInput
        style={styles.input}
        value={setCode}
        onChangeText={setSetCode}
        placeholder="e.g. BLB, DSK, OTJ"
        placeholderTextColor="#606078"
        autoCapitalize="characters"
        maxLength={5}
        returnKeyType="done"
        onSubmitEditing={handleCreate}
      />

      <Pressable style={[styles.createBtn, loading && styles.btnDisabled]} onPress={handleCreate} disabled={loading}>
        {loading
          ? <ActivityIndicator color="#0a0a0f" />
          : <Text style={styles.createBtnText}>✨ Begin Opening</Text>
        }
      </Pressable>

      <View style={{ marginTop: 24, alignItems: "center" }}>
        <Text style={{ color: "#a0a0b8", marginBottom: 8 }}>Just logging one card?</Text>
        <Pressable onPress={() => router.replace("/manual-entry")}>
          <Text style={{ color: "#c89b3c", fontSize: 16, fontWeight: "700" }}>✏️ Individual Entry</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0f" },
  content: { padding: 24, paddingBottom: 48 },

  manaBanner: { flexDirection: "row", justifyContent: "center", gap: 10, marginBottom: 24 },
  manaOrb: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#1a1a26", borderWidth: 1, alignItems: "center", justifyContent: "center" },
  manaEmoji: { fontSize: 17 },

  title: { color: "#f0f0f8", fontSize: 26, fontWeight: "900", marginBottom: 6 },
  subtitle: { color: "#a0a0b8", fontSize: 14, marginBottom: 28, lineHeight: 20 },
  label: { color: "#a0a0b8", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 },
  input: { backgroundColor: "#12121a", borderRadius: 14, borderWidth: 1, borderColor: "#222233", color: "#f0f0f8", fontSize: 16, padding: 16, marginBottom: 24 },
  presets: { marginBottom: 24 },
  preset: { backgroundColor: "#12121a", borderRadius: 12, padding: 14, marginRight: 10, borderWidth: 1, borderColor: "#222233", minWidth: 120, alignItems: "center" },
  presetSymbol: { color: "#c89b3c", fontSize: 16, marginBottom: 4 },
  presetName: { color: "#f0f0f8", fontWeight: "700", fontSize: 12, marginBottom: 4, textAlign: "center" },
  presetCost: { color: "#c89b3c", fontWeight: "800", fontSize: 15 },
  createBtn: { backgroundColor: "#c89b3c", borderRadius: 16, padding: 18, alignItems: "center", marginTop: 12 },
  createBtnText: { color: "#0a0a0f", fontWeight: "900", fontSize: 17 },
  btnDisabled: { opacity: 0.5 },
});
