import { useState, useRef } from "react";
import {
  View, Text, ScrollView, Pressable, TextInput,
  StyleSheet, Alert, Switch, ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { useAppStore } from "@store/appStore";
import { addCard } from "@db/queries";
import { searchCardByName, autocompleteCardName } from "@api/scryfall";
import type { ScryfallCard } from "@mtgtypes/index";
import * as Haptics from "expo-haptics";
import "react-native-get-random-values";
import { v4 as uuidv4 } from "uuid";

// ─── Types ────────────────────────────────────────────────────────────────────
type RarityKey = "common" | "uncommon" | "rare" | "mythic";
type CondKey = "NM" | "LP" | "MP" | "HP" | "DMG";
type ColorKey = "W" | "U" | "B" | "R" | "G";
type TypeKey = "Creature" | "Instant" | "Sorcery" | "Enchantment" | "Artifact" | "Planeswalker" | "Land" | "Other";

// ─── Data ─────────────────────────────────────────────────────────────────────
const MANA_DEFS: { key: ColorKey; emoji: string; bg: string; fg: string; border: string }[] = [
  { key: "W", emoji: "☀️", bg: "#f0e4a0", fg: "#3a3020", border: "#d4c060" },
  { key: "U", emoji: "💧", bg: "#1a4a80", fg: "#c0d8f0", border: "#3a7ac0" },
  { key: "B", emoji: "💀", bg: "#2a1a3a", fg: "#d0a0f0", border: "#6a3a9a" },
  { key: "R", emoji: "🔥", bg: "#8a1a10", fg: "#f8c0a0", border: "#c04020" },
  { key: "G", emoji: "🌿", bg: "#0a3a10", fg: "#80e0a0", border: "#207a40" },
];

const CARD_TYPES: TypeKey[] = [
  "Creature", "Instant", "Sorcery", "Enchantment", "Artifact", "Planeswalker", "Land", "Other",
];

const TYPE_ART: Record<TypeKey, string> = {
  Creature: "🐉",
  Instant: "⚡",
  Sorcery: "🔮",
  Enchantment: "✨",
  Artifact: "⚙️",
  Planeswalker: "🧙",
  Land: "🌋",
  Other: "🎴",
};

const RARITIES: { key: RarityKey; label: string; color: string }[] = [
  { key: "common", label: "Common", color: "#a0a0b0" },
  { key: "uncommon", label: "Uncommon", color: "#8ab4c4" },
  { key: "rare", label: "Rare", color: "#e8c060" },
  { key: "mythic", label: "Mythic", color: "#e87a3c" },
];

const CONDITIONS: CondKey[] = ["NM", "LP", "MP", "HP", "DMG"];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function frameColor(colors: ColorKey[]): string {
  if (colors.length === 0) return "#555566";
  if (colors.length > 1) return "#c89b3c";
  return { W: "#c4b050", U: "#2a6aaa", B: "#5a3a7a", R: "#aa2a1a", G: "#1a6a30" }[colors[0]];
}
function innerBg(colors: ColorKey[]): string {
  if (colors.length === 0) return "#18182a";
  if (colors.length > 1) return "#1e170a";
  return { W: "#1e1c10", U: "#0a1220", B: "#120a18", R: "#180a08", G: "#0a1410" }[colors[0]];
}
function artBg(colors: ColorKey[]): string {
  if (colors.length === 0) return "#0d0d1a";
  if (colors.length > 1) return "#130e06";
  return { W: "#18160a", U: "#060e1a", B: "#0e060e", R: "#140606", G: "#060e08" }[colors[0]];
}

function typeFromScryfall(typeLine: string): TypeKey {
  if (typeLine.includes("Planeswalker")) return "Planeswalker";
  if (typeLine.includes("Creature")) return "Creature";
  if (typeLine.includes("Instant")) return "Instant";
  if (typeLine.includes("Sorcery")) return "Sorcery";
  if (typeLine.includes("Enchantment")) return "Enchantment";
  if (typeLine.includes("Artifact")) return "Artifact";
  if (typeLine.includes("Land")) return "Land";
  return "Other";
}

// ─── Card Preview ─────────────────────────────────────────────────────────────
function CardPreview({
  name, colors, cardType, subtype, rulesText,
  power, toughness, loyalty, rarity, setCode, isFoil, isFullArt
}: {
  name: string; colors: ColorKey[]; cardType: TypeKey; subtype: string;
  rulesText: string; power: string; toughness: string; loyalty: string;
  rarity: RarityKey; setCode: string; isFoil: boolean; isFullArt?: boolean;
}) {
  const fc = frameColor(colors);
  const rarityColor = RARITIES.find((r) => r.key === rarity)?.color ?? "#a0a0b0";
  const typeLine = cardType + (subtype.trim() ? ` — ${subtype.trim()}` : "");

  return (
    <View style={[card.outer, { borderColor: fc, shadowColor: fc }]}>
      <View style={[card.inner, { backgroundColor: innerBg(colors) }]}>

        {/* ── Name bar ── */}
        <View style={[card.nameBar, { backgroundColor: fc + "28", borderBottomColor: fc + "55" }]}>
          <Text style={card.nameTxt} numberOfLines={1}>
            {name.trim() || "Card Name"}
          </Text>
          <View style={card.pipRow}>
            {colors.length === 0 ? (
              <View style={[card.pip, { backgroundColor: "#33334a", borderColor: "#555566" }]}>
                <Text style={{ color: "#8888aa", fontSize: 11 }}>◇</Text>
              </View>
            ) : (
              colors.map((c) => {
                const m = MANA_DEFS.find((d) => d.key === c)!;
                return (
                  <View key={c} style={[card.pip, { backgroundColor: m.bg, borderColor: m.border }]}>
                    <Text style={{ color: m.fg, fontSize: 11 }}>{m.emoji}</Text>
                  </View>
                );
              })
            )}
          </View>
        </View>

        {/* ── Art box ── */}
        <View style={[card.artBox, { backgroundColor: artBg(colors), borderColor: fc + "44" }]}>
          {isFoil && <View style={card.foilShimmer} />}
          <Text style={card.artEmoji}>{TYPE_ART[cardType]}</Text>
          {isFoil && <Text style={card.foilBadge}>✨ FOIL</Text>}
          {isFullArt && <Text style={[card.foilBadge, { top: isFoil ? 24 : 8, color: "#c89b3c" }]}>🖼️ FULL ART</Text>}
        </View>

        {/* ── Type line ── */}
        <View style={[card.typeLine, { backgroundColor: fc + "1a", borderColor: fc + "44" }]}>
          <Text style={card.typeTxt} numberOfLines={1}>{typeLine}</Text>
          <Text style={[card.setDot, { color: rarityColor }]}>◆</Text>
          <Text style={card.setCode}>{setCode.trim().toUpperCase() || "???"}</Text>
        </View>

        {/* ── Text box ── */}
        <View style={card.textBox}>
          {rulesText.trim() ? (
            <Text style={card.rulesTxt} numberOfLines={5}>{rulesText}</Text>
          ) : (
            <Text style={card.rulesPlaceholder}>(Oracle text)</Text>
          )}

          {cardType === "Creature" && (power.trim() || toughness.trim()) && (
            <View style={[card.ptBox, { borderColor: fc }]}>
              <Text style={card.ptTxt}>{power.trim() || "?"}/{toughness.trim() || "?"}</Text>
            </View>
          )}
          {cardType === "Planeswalker" && loyalty.trim() && (
            <View style={[card.ptBox, { borderColor: fc }]}>
              <Text style={card.ptTxt}>{loyalty.trim()}</Text>
            </View>
          )}
        </View>

        {/* ── Collector line ── */}
        <View style={[card.footLine, { borderTopColor: fc + "33" }]}>
          <Text style={card.collectorTxt}>
            {setCode.trim().toUpperCase() || "???"} · {rarity.charAt(0).toUpperCase() + rarity.slice(1)}
          </Text>
        </View>

      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ManualEntryScreen() {
  const { activeSession } = useAppStore();

  const [name, setName] = useState("");
  const [colors, setColors] = useState<ColorKey[]>([]);
  const [cardType, setCardType] = useState<TypeKey>("Creature");
  const [subtype, setSubtype] = useState("");
  const [rulesText, setRulesText] = useState("");
  const [power, setPower] = useState("");
  const [toughness, setToughness] = useState("");
  const [loyalty, setLoyalty] = useState("");
  const [rarity, setRarity] = useState<RarityKey>("common");
  const [setCode, setSetCode] = useState("");
  const [collNum, setCollNum] = useState("");
  const [condition, setCondition] = useState<CondKey>("NM");
  const [isFoil, setIsFoil] = useState(false);
  const [isFullArt, setIsFullArt] = useState(false);
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);

  // Scryfall lookup state
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [looking, setLooking] = useState(false);
  const [filledFromScryfall, setFilledFromScryfall] = useState(false);
  const [scryfallCard, setScryfallCard] = useState<ScryfallCard | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleColor = (c: ColorKey) =>
    setColors((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);

  // ── Autocomplete as user types ────────────────────────────────────────────
  const handleNameChange = (text: string) => {
    setName(text);
    setFilledFromScryfall(false);
    setScryfallCard(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.length >= 2) {
      debounceRef.current = setTimeout(async () => {
        const results = await autocompleteCardName(text);
        setSuggestions(results);
      }, 300);
    } else {
      setSuggestions([]);
    }
  };

  // ── Fill all fields from a Scryfall card object ───────────────────────────
  const fillFromScryfall = (sc: ScryfallCard) => {
    setName(sc.name);
    const validColors = (sc.colors ?? []).filter(
      (c): c is ColorKey => ["W", "U", "B", "R", "G"].includes(c)
    );
    setColors(validColors);
    const validRarity: RarityKey = ["common", "uncommon", "rare", "mythic"].includes(sc.rarity)
      ? (sc.rarity as RarityKey)
      : "common";
    setRarity(validRarity);
    setSetCode(sc.set.toUpperCase());
    setCollNum(sc.collector_number);
    const [mainType, subPart] = (sc.type_line ?? "").split("—").map((s) => s.trim());
    setCardType(typeFromScryfall(mainType ?? ""));
    setSubtype(subPart ?? "");
    setRulesText(sc.oracle_text ?? "");
    if (sc.power) setPower(sc.power);
    if (sc.toughness) setToughness(sc.toughness);
    if (sc.loyalty) setLoyalty(sc.loyalty);
    const priceVal = isFoil ? sc.prices.usd_foil : sc.prices.usd;
    if (priceVal) setPrice(priceVal);
    setScryfallCard(sc);
    setFilledFromScryfall(true);
    setSuggestions([]);
  };

  // ── Lookup from Scryfall by current name ─────────────────────────────────
  const handleScryfallLookup = async () => {
    if (!name.trim()) return;
    setSuggestions([]);
    setLooking(true);
    try {
      const results = await searchCardByName(name.trim());
      if (results.length === 0) {
        Alert.alert("Not Found", "No card found with that name on Scryfall.");
        return;
      }
      fillFromScryfall(results[0]);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      Alert.alert("Error", "Failed to look up card. Check your connection.");
    } finally {
      setLooking(false);
    }
  };

  // ── Select an autocomplete suggestion ────────────────────────────────────
  const handleSuggestionSelect = async (suggestion: string) => {
    setSuggestions([]);
    setName(suggestion);
    setLooking(true);
    try {
      const results = await searchCardByName(suggestion);
      if (results.length > 0) {
        fillFromScryfall(results[0]);
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch {
      // Silently ignore — user can still fill manually
    } finally {
      setLooking(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert("Name required", "Please give your card a name.");
      return;
    }
    if (!activeSession) {
      Alert.alert("No active opening", "Please select or create an opening first.");
      return;
    }
    const parsedPrice = parseFloat(price) || null;
    setSaving(true);
    try {
      await addCard({
        sessionId: activeSession.id,
        scryfallId: scryfallCard?.id ?? uuidv4(),
        name: name.trim(),
        setCode: setCode.trim().toUpperCase() || "???",
        setName: ((scryfallCard?.set_name ?? setCode.trim().toUpperCase()) || "") + (isFullArt ? " (Full Art)" : ""),
        collectorNumber: collNum.trim() || "0",
        rarity,
        colors,
        isFoil,
        condition,
        quantity: 1,
        priceUsd: isFoil ? null : parsedPrice,
        priceUsdFoil: isFoil ? parsedPrice : null,
        imageUri: scryfallCard
          ? (scryfallCard.image_uris?.normal ?? scryfallCard.card_faces?.[0]?.image_uris?.normal ?? null)
          : null,
        scryfallUri: scryfallCard?.scryfall_uri ?? null,
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
    <View style={s.container}>
      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Live Card Preview ── */}
        <View style={s.previewArea}>
          <CardPreview
            name={name} colors={colors} cardType={cardType} subtype={subtype}
            rulesText={rulesText} power={power} toughness={toughness}
            loyalty={loyalty} rarity={rarity} setCode={setCode} isFoil={isFoil} isFullArt={isFullArt}
          />
        </View>

        {/* ── Scryfall Lookup Banner ── */}
        {filledFromScryfall && scryfallCard && (
          <View style={s.scryfallBanner}>
            <Text style={s.scryfallBannerIcon}>✅</Text>
            <Text style={s.scryfallBannerText}>
              Filled from Scryfall · {scryfallCard.set_name}
            </Text>
          </View>
        )}

        {/* ── Card Name + Lookup ── */}
        <Text style={s.label}>Card Name *</Text>
        <View style={s.nameRow}>
          <TextInput
            style={[s.input, { flex: 1, marginBottom: 0 }]}
            value={name}
            onChangeText={handleNameChange}
            placeholder="e.g. Lightning Bolt"
            placeholderTextColor="#606078"
            autoFocus
            returnKeyType="search"
            onSubmitEditing={handleScryfallLookup}
          />
          <Pressable
            style={[s.lookupBtn, (!name.trim() || looking) && s.btnDisabled]}
            onPress={handleScryfallLookup}
            disabled={!name.trim() || looking}
          >
            {looking
              ? <ActivityIndicator color="#0a0a0f" size="small" />
              : <Text style={s.lookupBtnText}>🔍</Text>
            }
          </Pressable>
        </View>

        {/* ── Autocomplete Suggestions ── */}
        {suggestions.length > 0 && (
          <View style={s.suggestionsBox}>
            {suggestions.map((sug) => (
              <Pressable
                key={sug}
                style={s.suggestionItem}
                onPress={() => handleSuggestionSelect(sug)}
              >
                <Text style={s.suggestionText}>{sug}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={{ height: 16 }} />

        {/* ── Color Identity ── */}
        <Text style={s.label}>Color Identity</Text>
        <View style={s.manaRow}>
          {MANA_DEFS.map((m) => {
            const active = colors.includes(m.key);
            return (
              <Pressable
                key={m.key}
                style={[s.manaBtn, active && { borderColor: m.border, backgroundColor: m.bg + "22" }]}
                onPress={() => toggleColor(m.key)}
              >
                <Text style={s.manaBtnEmoji}>{m.emoji}</Text>
                <Text style={[s.manaBtnLabel, active && { color: "#f0f0f8", fontWeight: "800" }]}>{m.key}</Text>
              </Pressable>
            );
          })}
          {/* Colorless button */}
          <Pressable
            style={[s.manaBtn, colors.length === 0 && { borderColor: "#888899", backgroundColor: "#88889920" }]}
            onPress={() => setColors([])}
          >
            <Text style={s.manaBtnEmoji}>◇</Text>
            <Text style={[s.manaBtnLabel, colors.length === 0 && { color: "#aaaacc", fontWeight: "800" }]}>∅</Text>
          </Pressable>
        </View>

        {/* ── Card Type ── */}
        <Text style={s.label}>Card Type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.hScroll}>
          {CARD_TYPES.map((t) => (
            <Pressable
              key={t}
              style={[s.typeChip, cardType === t && s.chipActive]}
              onPress={() => setCardType(t)}
            >
              <Text style={[s.chipTxt, cardType === t && s.chipTxtActive]}>
                {TYPE_ART[t]} {t}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* ── Subtype ── */}
        <Text style={s.label}>Subtype / Creature Type</Text>
        <TextInput
          style={s.input} value={subtype} onChangeText={setSubtype}
          placeholder="e.g. Dragon, Wizard, Aura..."
          placeholderTextColor="#606078"
        />

        {/* ── Rules Text ── */}
        <Text style={s.label}>Rules Text</Text>
        <TextInput
          style={[s.input, s.multiline]} value={rulesText} onChangeText={setRulesText}
          placeholder={"Flying\nFirst strike\n\"Flavor text in quotes.\""}
          placeholderTextColor="#606078"
          multiline numberOfLines={4} textAlignVertical="top"
        />

        {/* ── Power / Toughness ── */}
        {cardType === "Creature" && (
          <>
            <Text style={s.label}>Power / Toughness</Text>
            <View style={s.ptRow}>
              <TextInput
                style={[s.input, s.ptInput]} value={power} onChangeText={setPower}
                placeholder="3" placeholderTextColor="#606078" keyboardType="numeric"
              />
              <Text style={s.ptSlash}>/</Text>
              <TextInput
                style={[s.input, s.ptInput]} value={toughness} onChangeText={setToughness}
                placeholder="3" placeholderTextColor="#606078" keyboardType="numeric"
              />
            </View>
          </>
        )}

        {/* ── Loyalty (Planeswalker) ── */}
        {cardType === "Planeswalker" && (
          <>
            <Text style={s.label}>Starting Loyalty</Text>
            <TextInput
              style={[s.input, { width: 100 }]} value={loyalty} onChangeText={setLoyalty}
              placeholder="4" placeholderTextColor="#606078" keyboardType="numeric"
            />
          </>
        )}

        {/* ── Rarity ── */}
        <Text style={s.label}>Rarity</Text>
        <View style={s.rarityRow}>
          {RARITIES.map((r) => (
            <Pressable
              key={r.key}
              style={[s.rarityBtn, rarity === r.key && { borderColor: r.color, backgroundColor: r.color + "18" }]}
              onPress={() => setRarity(r.key)}
            >
              <Text style={[s.rarityDiamond, { color: r.color }]}>◆</Text>
              <Text style={[s.rarityLabel, rarity === r.key && { color: r.color, fontWeight: "700" }]}>
                {r.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* ── Set Info ── */}
        <View style={s.twoCol}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Set Code</Text>
            <TextInput
              style={s.input} value={setCode} onChangeText={setSetCode}
              placeholder="BLB" placeholderTextColor="#606078"
              autoCapitalize="characters" maxLength={5}
            />
          </View>
          <View style={{ width: 12 }} />
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Collector #</Text>
            <TextInput
              style={s.input} value={collNum} onChangeText={setCollNum}
              placeholder="001" placeholderTextColor="#606078" keyboardType="numeric"
            />
          </View>
        </View>

        {/* ── Condition ── */}
        <Text style={s.label}>Condition</Text>
        <View style={s.condRow}>
          {CONDITIONS.map((c) => (
            <Pressable
              key={c}
              style={[s.condBtn, condition === c && s.condBtnActive]}
              onPress={() => setCondition(c)}
            >
              <Text style={[s.condTxt, condition === c && s.condTxtActive]}>{c}</Text>
            </Pressable>
          ))}
        </View>

        {/* ── Foil ── */}
        <View style={s.settingRow}>
          <Text style={s.settingLabel}>✨ Foil Card</Text>
          <Switch
            value={isFoil} onValueChange={setIsFoil}
            trackColor={{ false: "#222233", true: "#4a9eff" }}
            thumbColor="#f0f0f8"
          />
        </View>

        {/* ── Full Art ── */}
        <View style={s.settingRow}>
          <Text style={s.settingLabel}>🖼️ Full Art</Text>
          <Switch
            value={isFullArt} onValueChange={setIsFullArt}
            trackColor={{ false: "#222233", true: "#c89b3c" }}
            thumbColor="#f0f0f8"
          />
        </View>

        {/* ── Price ── */}
        <Text style={s.label}>Market Value (optional)</Text>
        <TextInput
          style={s.input} value={price} onChangeText={setPrice}
          placeholder="$0.00" placeholderTextColor="#606078" keyboardType="decimal-pad"
        />

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* ── Footer ── */}
      <View style={s.footer}>
        <Pressable style={s.cancelBtn} onPress={() => router.back()} disabled={saving}>
          <Text style={s.cancelTxt}>← Back</Text>
        </Pressable>
        <Pressable
          style={[s.saveBtn, (!name.trim() || saving) && s.btnDisabled]}
          onPress={handleSave}
          disabled={!name.trim() || saving}
        >
          {saving
            ? <ActivityIndicator color="#0a0a0f" size="small" />
            : <Text style={s.saveTxt}>⚔️ Add to Library</Text>
          }
        </Pressable>
      </View>
    </View>
  );
}

// ─── Card Styles ──────────────────────────────────────────────────────────────
const card = StyleSheet.create({
  outer: {
    width: 280,
    borderWidth: 4,
    borderRadius: 18,
    padding: 4,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.7,
    shadowRadius: 20,
    elevation: 20,
    backgroundColor: "#060608",
  },
  inner: {
    borderRadius: 12,
    overflow: "hidden",
  },
  nameBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
  },
  nameTxt: {
    color: "#f0f0f8",
    fontWeight: "800",
    fontSize: 13,
    flex: 1,
    letterSpacing: 0.2,
  },
  pipRow: {
    flexDirection: "row",
    gap: 3,
    marginLeft: 6,
  },
  pip: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  artBox: {
    height: 168,
    alignItems: "center",
    justifyContent: "center",
    borderTopWidth: 1.5,
    borderBottomWidth: 1.5,
    position: "relative",
  },
  artEmoji: { fontSize: 68 },
  foilShimmer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(160,140,255,0.10)",
  },
  foilBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    color: "#b8a0f0",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  typeLine: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    gap: 5,
  },
  typeTxt: { color: "#d8d8f0", fontSize: 11, fontWeight: "700", flex: 1 },
  setDot: { fontSize: 11 },
  setCode: { color: "#808098", fontSize: 10, fontWeight: "600" },
  textBox: {
    minHeight: 106,
    padding: 10,
    position: "relative",
  },
  rulesTxt: { color: "#c0c0d8", fontSize: 11, lineHeight: 15, fontStyle: "italic" },
  rulesPlaceholder: { color: "#383848", fontSize: 11, fontStyle: "italic" },
  ptBox: {
    position: "absolute",
    bottom: 6,
    right: 8,
    backgroundColor: "#0a0a14",
    borderWidth: 2,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    minWidth: 44,
    alignItems: "center",
  },
  ptTxt: { color: "#f0f0f8", fontWeight: "900", fontSize: 13 },
  footLine: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderTopWidth: 1,
    alignItems: "center",
  },
  collectorTxt: { color: "#404055", fontSize: 9, letterSpacing: 0.5, fontWeight: "600" },
});

// ─── Screen Styles ────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0f" },
  content: { padding: 20, paddingBottom: 40 },

  previewArea: {
    alignItems: "center",
    marginBottom: 32,
    marginTop: 4,
  },

  // Scryfall banner
  scryfallBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#0a2010",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#22c55e44",
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 20,
  },
  scryfallBannerIcon: { fontSize: 14 },
  scryfallBannerText: { color: "#22c55e", fontSize: 13, fontWeight: "600", flex: 1 },

  label: {
    color: "#a0a0b8",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#12121a",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#222233",
    color: "#f0f0f8",
    fontSize: 15,
    padding: 14,
    marginBottom: 20,
  },
  multiline: { height: 90, textAlignVertical: "top" },

  // Name row with lookup button
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 0,
  },
  lookupBtn: {
    backgroundColor: "#c89b3c",
    borderRadius: 14,
    width: 50,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  lookupBtnText: { fontSize: 20 },

  // Autocomplete suggestions
  suggestionsBox: {
    backgroundColor: "#12121a",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#c89b3c44",
    overflow: "hidden",
    marginTop: 4,
    marginBottom: 4,
  },
  suggestionItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1e1e2e",
  },
  suggestionText: { color: "#f0f0f8", fontSize: 14 },

  // Mana
  manaRow: { flexDirection: "row", gap: 6, marginBottom: 20 },
  manaBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    backgroundColor: "#12121a",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#222233",
  },
  manaBtnEmoji: { fontSize: 17, marginBottom: 2 },
  manaBtnLabel: { color: "#606078", fontSize: 11, fontWeight: "600" },

  // Type chips
  hScroll: { marginBottom: 20 },
  typeChip: {
    backgroundColor: "#12121a",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginRight: 8,
    borderWidth: 1,
    borderColor: "#222233",
  },
  chipActive: { borderColor: "#c89b3c", backgroundColor: "#1e1a0f" },
  chipTxt: { color: "#a0a0b8", fontSize: 13, fontWeight: "600" },
  chipTxtActive: { color: "#c89b3c" },

  // Rarity
  rarityRow: { flexDirection: "row", gap: 8, marginBottom: 20 },
  rarityBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 11,
    backgroundColor: "#12121a",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#222233",
  },
  rarityDiamond: { fontSize: 14, marginBottom: 3 },
  rarityLabel: { color: "#606078", fontSize: 10, fontWeight: "600" },

  // Two-column layout
  twoCol: { flexDirection: "row" },

  // P/T
  ptRow: { flexDirection: "row", alignItems: "center", marginBottom: 20 },
  ptInput: { flex: 1, marginBottom: 0 },
  ptSlash: { color: "#f0f0f8", fontSize: 26, fontWeight: "900", marginHorizontal: 10 },

  // Condition
  condRow: { flexDirection: "row", gap: 8, marginBottom: 20 },
  condBtn: {
    flex: 1,
    backgroundColor: "#12121a",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#222233",
  },
  condBtnActive: { backgroundColor: "#1e1a0f", borderColor: "#c89b3c" },
  condTxt: { color: "#a0a0b8", fontWeight: "700", fontSize: 13 },
  condTxtActive: { color: "#c89b3c" },

  // Foil toggle
  settingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#12121a",
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#222233",
  },
  settingLabel: { color: "#f0f0f8", fontSize: 15, fontWeight: "600" },

  // Footer
  footer: {
    position: "absolute",
    bottom: 0, left: 0, right: 0,
    flexDirection: "row",
    gap: 12,
    padding: 20,
    paddingBottom: 36,
    backgroundColor: "#0a0a0f",
    borderTopWidth: 1,
    borderTopColor: "#222233",
  },
  cancelBtn: {
    backgroundColor: "#12121a",
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: "#222233",
  },
  cancelTxt: { color: "#a0a0b8", fontWeight: "700" },
  saveBtn: { flex: 1, backgroundColor: "#c89b3c", borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  saveTxt: { color: "#0a0a0f", fontWeight: "900", fontSize: 16 },
  btnDisabled: { opacity: 0.4 },
});
