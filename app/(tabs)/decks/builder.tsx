import { useState, useEffect, useCallback } from "react";
import {
    View,
    Text,
    FlatList,
    Pressable,
    TextInput,
    StyleSheet,
    ActivityIndicator,
    Image,
    ImageBackground,
    Alert,
    Platform,
    ScrollView,
    Dimensions,
} from "react-native";
import { router } from "expo-router";
import { useAppStore } from "@store/appStore";
import { supabase } from "@/lib/supabase";
import type { DbCard } from "@/lib/supabase";
import { useDeckStats } from "@/hooks/useDeckStats";

const { width, height } = Dimensions.get("window");

// Mana curve colors based on MTG color identity
const MANA_COLORS = {
    W: "#f0f0f8",
    U: "#3a7ac0",
    B: "#7a50a0",
    R: "#c04020",
    G: "#207a40",
    C: "#a0a0b0",
};

export default function DeckBuilderScreen() {
    const { activeSession, activeTheme } = useAppStore();
    const [deckName, setDeckName] = useState("");
    const [deckFormat, setDeckFormat] = useState("Draft");
    const [deckDate, setDeckDate] = useState(new Date().toISOString().split("T")[0]);
    const [cards, setCards] = useState<DbCard[]>([]);
    const [deckList, setDeckList] = useState<Map<string, { card: DbCard; quantity: number; zone: string }>>(new Map());
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Fetch user's draft pool (recently scanned cards from active session)
    useEffect(() => {
        const loadPool = async () => {
            if (!activeSession) return;
            setLoading(true);
            try {
                const { data, error } = await supabase
                    .from("cards")
                    .select("*")
                    .eq("session_id", activeSession.id)
                    .order("added_at", { ascending: true });
                if (error) throw error;
                setCards(data || []);
            } catch (error) {
                console.error("Failed to load draft pool:", error);
            } finally {
                setLoading(false);
            }
        };
        loadPool();
    }, [activeSession]);

    // Deck statistics hook
    const stats = useDeckStats(deckList);

    // Add card to deck
    const addToDeck = (card: DbCard, zone: string = "mainboard") => {
        const id = card.id;
        const current = deckList.get(id);
        if (current) {
            // Increase quantity if under limit (60 for Commander, 40 for others)
            const limit = deckFormat === "Commander" ? 1 : 4;
            if (current.quantity < limit) {
                setDeckList(new Map(deckList).set(id, {
                    ...current,
                    quantity: current.quantity + 1,
                }));
            }
        } else {
            setDeckList(new Map(deckList).set(id, {
                card,
                quantity: 1,
                zone,
            }));
        }
    };

    // Remove card from deck
    const removeFromDeck = (cardId: string) => {
        const newDeck = new Map(deckList);
        newDeck.delete(cardId);
        setDeckList(newDeck);
    };

    // Update card quantity
    const updateQuantity = (cardId: string, quantity: number) => {
        if (quantity <= 0) {
            removeFromDeck(cardId);
            return;
        }
        const current = deckList.get(cardId);
        if (current) {
            const limit = current.card.is_foil && current.card.rarity === "mythic" ? 1 :
                current.card.rarity === "mythic" ? 1 : 4;
            const newQty = Math.min(quantity, limit);
            setDeckList(new Map(deckList).set(cardId, {
                ...current,
                quantity: newQty,
            }));
        }
    };

    // Get cards by zone
    const getCardsByZone = (zone: string) => {
        return Array.from(deckList.values())
            .filter(item => item.zone === zone)
            .sort((a, b) => a.card.name.localeCompare(b.name));
    };

    // Calculate total cards in deck
    const totalCards = Array.from(deckList.values()).reduce((sum, item) => sum + item.quantity, 0);

    // Save deck to database
    const saveDeck = async () => {
        if (!activeSession || !deckName.trim()) return;
        setSaving(true);
        try {
            // Start transaction
            await supabase.rpc("save_deck", {
                userId: activeSession.user_id,
                name: deckName,
                format: deckFormat,
                eventDate: deckDate,
                cards: Array.from(deckList.entries()).map(([cardId, item]) => ({
                    card_id: cardId,
                    quantity: item.quantity,
                    zone: item.zone,
                })),
            });
            Alert.alert("Success", "Deck saved successfully!");
            router.push("/decks");
        } catch (error) {
            console.error("Failed to save deck:", error);
            Alert.alert("Error", "Failed to save deck. Please try again.");
        } finally {
            setSaving(false);
        }
    };

    // Get cover card (highest rarity or CMC)
    const getCoverCard = () => {
        const allCards = Array.from(deckList.values());
        if (allCards.length === 0) return null;

        // Sort by rarity then CMC
        const sorted = [...allCards].sort((a, b) => {
            const rarityOrder = { mythic: 4, rare: 3, uncommon: 2, common: 1 };
            const aRarity = rarityOrder[a.card.rarity] || 0;
            const bRarity = rarityOrder[b.card.rarity] || 0;
            if (aRarity !== bRarity) return bRarity - aRarity;
            const aCmc = a.card.cmc || 0;
            const bCmc = b.card.cmc || 0;
            return bCmc - aCmc;
        });
        return sorted[0].card;
    };

    const coverCard = getCoverCard();

    return (
        <View style={styles.container}>
            {/* Sticky Header */}
            <View style={styles.header}>
                <View style={styles.headerContent}>
                    <TextInput
                        style={styles.deckNameInput}
                        value={deckName}
                        onChangeText={setDeckName}
                        placeholder="Deck Name"
                        placeholderTextColor="#606078"
                    />
                    <View style={styles.cardCountBadge}>
                        <Text style={styles.cardCountText}>{totalCards} / 40</Text>
                    </View>
                </View>
                <View style={styles.formatPicker}>
                    <Pressable
                        style={[styles.formatButton, deckFormat === "Draft" && styles.formatButtonActive]}
                        onPress={() => setDeckFormat("Draft")}
                    >
                        <Text style={[styles.formatText, deckFormat === "Draft" && styles.formatTextActive]}>Draft</Text>
                    </Pressable>
                    <Pressable
                        style={[styles.formatButton, deckFormat === "Commander" && styles.formatButtonActive]}
                        onPress={() => setDeckFormat("Commander")}
                    >
                        <Text style={[styles.formatButton, deckFormat === "Commander" && styles.formatButtonActive]}>
                            <Text style={[styles.formatText, deckFormat === "Commander" && styles.formatTextActive]}>Commander</Text>
                        </Text>
                    </Pressable>
                </View>
            </View>

            {/* Mana Curve Visualization */}
            <View style={styles.manaCurveSection}>
                <Text style={styles.sectionTitle}>Mana Curve</Text>
                <View style={styles.manaCurveContainer}>
                    {stats.curve.map((count, cmc) => (
                        <View key={cmc} style={styles.manaCurveBarWrapper}>
                            <Text style={styles.curveLabel}>{cmc === 7 ? "7+" : cmc}</Text>
                            <View style={styles.manaCurveBar}>
                                <View
                                    style={[
                                        styles.manaCurveFill,
                                        { height: `${(count / Math.max(...stats.curve, 1)) * 100}%`, backgroundColor: getCurveColor(cmc) },
                                    ]}
                                />
                            </View>
                            <Text style={styles.curveCount}>{count}</Text>
                        </View>
                    ))}
                </View>
            </View>

            {/* Main Content - Pool & Decklist */}
            <View style={styles.contentContainer}>
                {/* Draft Pool */}
                <View style={styles.poolSection}>
                    <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle}>Draft Pool</Text>
                        <Text style={styles.sectionSubtitle}>{cards.length} cards available</Text>
                    </View>
                    <FlatList
                        data={cards}
                        keyExtractor={(item) => item.id}
                        numColumns={4}
                        renderItem={({ item }) => (
                            <Pressable
                                style={styles.cardThumbnail}
                                onPress={() => addToDeck(item)}
                            >
                                {item.image_uri ? (
                                    <Image source={{ uri: item.image_uri }} style={styles.cardImage} resizeMode="cover" />
                                ) : (
                                    <View style={styles.cardPlaceholder}>
                                        <Text style={styles.cardPlaceholderText}>🃏</Text>
                                    </View>
                                )}
                                <Text style={styles.cardNameSmall}>{item.name}</Text>
                            </Pressable>
                        )}
                    />
                </View>

                {/* Decklist */}
                <View style={styles.decklistSection}>
                    <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle}>Decklist</Text>
                        <Text style={styles.sectionSubtitle}>{totalCards} cards</Text>
                    </View>

                    {/* Mainboard */}
                    <View style={styles.zoneSection}>
                        <Text style={styles.zoneTitle}>Mainboard</Text>
                        {getCardsByZone("mainboard").length === 0 ? (
                            <Text style={styles.emptyMessage}>Tap cards from pool to add</Text>
                        ) : (
                            <FlatList
                                data={getCardsByZone("mainboard")}
                                keyExtractor={(item) => item.card.id}
                                renderItem={({ item }) => (
                                    <View style={styles.deckCardItem}>
                                        <View style={styles.deckCardInfo}>
                                            <Text style={styles.deckCardName}>{item.card.name}</Text>
                                            <Text style={styles.deckCardDetails}>
                                                {item.card.mana_cost || ""} • {item.card.type_line} • {item.card.rarity.charAt(0).toUpperCase()}
                                            </Text>
                                        </View>
                                        <View style={styles.deckCardControls}>
                                            <Pressable
                                                style={styles.quantityButton}
                                                onPress={() => updateQuantity(item.card.id, item.quantity - 1)}
                                            >
                                                <Text style={styles.quantityText}>-</Text>
                                            </Pressable>
                                            <Text style={styles.quantityValue}>{item.quantity}</Text>
                                            <Pressable
                                                style={styles.quantityButton}
                                                onPress={() => updateQuantity(item.card.id, item.quantity + 1)}
                                            >
                                                <Text style={styles.quantityText}>+</Text>
                                            </Pressable>
                                            <Pressable
                                                style={styles.deleteButton}
                                                onPress={() => removeFromDeck(item.card.id)}
                                            >
                                                <Text style={styles.deleteText}>🗑️</Text>
                                            </Pressable>
                                        </View>
                                    </View>
                                )}
                            />
                        )}
                    </View>

                    {/* Sideboard */}
                    <View style={styles.zoneSection}>
                        <View style={styles.zoneHeader}>
                            <Text style={styles.zoneTitle}>Sideboard</Text>
                            <Pressable
                                style={styles.addToSideboardButton}
                                onPress={() => {
                                    // Quick add: open card selector or add from pool
                                }}
                            >
                                <Text style={styles.addText}>+ Add</Text>
                            </Pressable>
                        </View>
                        {getCardsByZone("sideboard").length === 0 ? (
                            <Text style={styles.emptyMessage}>No sideboard cards</Text>
                        ) : (
                            <FlatList
                                data={getCardsByZone("sideboard")}
                                keyExtractor={(item) => item.card.id}
                                renderItem={({ item }) => (
                                    <View style={styles.deckCardItem}>
                                        <View style={styles.deckCardInfo}>
                                            <Text style={styles.deckCardName}>{item.card.name}</Text>
                                            <Text style={styles.deckCardDetails}>
                                                {item.card.mana_cost || ""} • {item.card.type_line}
                                            </Text>
                                        </View>
                                        <View style={styles.deckCardControls}>
                                            <Pressable
                                                style={styles.quantityButton}
                                                onPress={() => updateQuantity(item.card.id, item.quantity - 1)}
                                            >
                                                <Text style={styles.quantityText}>-</Text>
                                            </Pressable>
                                            <Text style={styles.quantityValue}>{item.quantity}</Text>
                                            <Pressable
                                                style={styles.quantityButton}
                                                onPress={() => updateQuantity(item.card.id, item.quantity + 1)}
                                            >
                                                <Text style={styles.quantityText}>+</Text>
                                            </Pressable>
                                            <Pressable
                                                style={styles.deleteButton}
                                                onPress={() => removeFromDeck(item.card.id)}
                                            >
                                                <Text style={styles.deleteText}>🗑️</Text>
                                            </Pressable>
                                        </View>
                                    </View>
                                )}
                            />
                        )}
                    </View>

                    {/* Commander (for Commander format) */}
                    {deckFormat === "Commander" && (
                        <View style={styles.zoneSection}>
                            <View style={styles.zoneHeader}>
                                <Text style={styles.zoneTitle}>Commander</Text>
                                <Pressable
                                    style={styles.addToSideboardButton}
                                    onPress={() => { }}
                                >
                                    <Text style={styles.addText}>+ Add</Text>
                                </Pressable>
                            </View>
                            {getCardsByZone("commander").length === 0 ? (
                                <Text style={styles.emptyMessage}>No commander selected</Text>
                            ) : (
                                <FlatList
                                    data={getCardsByZone("commander")}
                                    keyExtractor={(item) => item.card.id}
                                    renderItem={({ item }) => (
                                        <View style={styles.deckCardItem}>
                                            <View style={styles.deckCardInfo}>
                                                <Text style={styles.deckCardName}>{item.card.name}</Text>
                                                <Text style={styles.deckCardDetails}>
                                                    {item.card.mana_cost || ""} • {item.card.type_line}
                                                </Text>
                                            </View>
                                            <View style={styles.deckCardControls}>
                                                <Pressable
                                                    style={styles.quantityButton}
                                                    onPress={() => updateQuantity(item.card.id, item.quantity - 1)}
                                                >
                                                    <Text style={styles.quantityText}>-</Text>
                                                </Pressable>
                                                <Text style={styles.quantityValue}>{item.quantity}</Text>
                                                <Pressable
                                                    style={styles.quantityButton}
                                                    onPress={() => updateQuantity(item.card.id, item.quantity + 1)}
                                                >
                                                    <Text style={styles.quantityText}>+</Text>
                                                </Pressable>
                                                <Pressable
                                                    style={styles.deleteButton}
                                                    onPress={() => removeFromDeck(item.card.id)}
                                                >
                                                    <Text style={styles.deleteText}>🗑️</Text>
                                                </Pressable>
                                            </View>
                                        </View>
                                    )}
                                />
                            )}
                        </View>
                    )}
                </View>
            </View>

            {/* Save Button */}
            <Pressable style={styles.saveButton} onPress={saveDeck} disabled={saving}>
                {saving ? (
                    <ActivityIndicator color="#f0f0f8" />
                ) : (
                    <Text style={styles.saveButtonText}>💾 Save Deck</Text>
                )}
            </Pressable>
        </View>
    );

    function getCurveColor(cmc: number): string {
        if (cmc === 0) return MANA_COLORS.C;
        if (cmc <= 3) return MANA_COLORS.G;
        if (cmc <= 5) return MANA_COLORS.R;
        return MANA_COLORS.B;
    }
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#0a0a0f",
    },
    header: {
        paddingTop: 20,
        paddingHorizontal: 16,
        paddingBottom: 12,
        backgroundColor: "#12121a",
        zIndex: 1000,
    },
    headerContent: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 12,
    },
    deckNameInput: {
        flex: 1,
        color: "#f0f0f8",
        fontSize: 18,
        fontWeight: "bold",
        backgroundColor: "#1a1a26",
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderWidth: 1,
        borderColor: "#222233",
    },
    cardCountBadge: {
        backgroundColor: "#c89b3c",
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 8,
        marginLeft: 12,
    },
    cardCountText: {
        color: "#0a0a0f",
        fontWeight: "bold",
        fontSize: 16,
    },
    formatPicker: {
        flexDirection: "row",
        justifyContent: "center",
        gap: 8,
    },
    formatButton: {
        backgroundColor: "#1a1a26",
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderWidth: 1,
        borderColor: "#222233",
    },
    formatButtonActive: {
        backgroundColor: "#c89b3c",
        borderColor: "#c89b3c",
    },
    formatText: {
        color: "#a0a0b8",
        fontSize: 14,
        fontWeight: "600",
    },
    formatTextActive: {
        color: "#0a0a0f",
    },
    manaCurveSection: {
        backgroundColor: "#12121a",
        padding: 16,
        paddingTop: 20,
    },
    sectionTitle: {
        color: "#c89b3c",
        fontSize: 16,
        fontWeight: "700",
        marginBottom: 12,
        letterSpacing: 0.5,
    },
    manaCurveContainer: {
        flexDirection: "row",
        justifyContent: "space-around",
        alignItems: "flex-end",
        height: 120,
    },
    manaCurveBarWrapper: {
        alignItems: "center",
        width: 40,
    },
    curveLabel: {
        color: "#a0a0b8",
        fontSize: 12,
        marginBottom: 4,
    },
    manaCurveBar: {
        flex: 1,
        height: "100%",
        backgroundColor: "#222233",
        borderRadius: 4,
        marginBottom: 4,
    },
    manaCurveFill: {
        borderRadius: 4,
        width: "100%",
    },
    curveCount: {
        color: "#f0f0f8",
        fontSize: 12,
        fontWeight: "bold",
    },
    contentContainer: {
        flex: 1,
    },
    poolSection: {
        flex: 1,
        padding: 16,
        backgroundColor: "#0a0a0f",
    },
    decklistSection: {
        backgroundColor: "#12121a",
        padding: 16,
        paddingBottom: 80, // Make room for save button
    },
    sectionHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 16,
    },
    sectionSubtitle: {
        color: "#606078",
        fontSize: 13,
    },
    zoneSection: {
        marginBottom: 20,
    },
    zoneHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 8,
    },
    zoneTitle: {
        color: "#c89b3c",
        fontSize: 16,
        fontWeight: "700",
    },
    addToSideboardButton: {
        backgroundColor: "#1a1a26",
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderWidth: 1,
        borderColor: "#222233",
    },
    addText: {
        color: "#a0a0b8",
        fontSize: 12,
        fontWeight: "600",
    },
    emptyMessage: {
        color: "#606078",
        fontSize: 14,
        textAlign: "center",
        marginTop: 20,
    },
    cardThumbnail: {
        width: (width - 48) / 4,
        aspectRatio: 5 / 7,
        marginBottom: 12,
        marginRight: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    cardImage: {
        width: "100%",
        height: "100%",
        borderRadius: 4,
    },
    cardPlaceholder: {
        width: "100%",
        height: "100%",
        backgroundColor: "#1a1a26",
        borderRadius: 4,
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 4,
    },
    cardPlaceholderText: {
        fontSize: 20,
    },
    cardNameSmall: {
        color: "#f0f0f8",
        fontSize: 10,
        textAlign: "center",
        marginTop: 4,
        lineHeight: 14,
    },
    deckCardItem: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        padding: 12,
        backgroundColor: "#1a1a26",
        borderRadius: 8,
        marginBottom: 8,
    },
    deckCardInfo: {
        flex: 1,
    },
    deckCardName: {
        color: "#f0f0f8",
        fontSize: 15,
        fontWeight: "700",
        marginBottom: 4,
    },
    deckCardDetails: {
        color: "#a0a0b8",
        fontSize: 12,
    },
    deckCardControls: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    quantityButton: {
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: "#222233",
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: "#333344",
    },
    quantityValue: {
        fontSize: 16,
        fontWeight: "bold",
        color: "#f0f0f8",
        minWidth: 12,
        textAlign: "center",
    },
    deleteButton: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
    },
    deleteText: {
        fontSize: 16,
        color: "#ef4444",
    },
    saveButton: {
        backgroundColor: "#c89b3c",
        borderRadius: 12,
        paddingVertical: 16,
        paddingHorizontal: 24,
        alignItems: "center",
        justifyContent: "center",
        position: "absolute",
        bottom: 20,
        left: 20,
        right: 20,
        shadowColor: "#000000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 5,
    },
    saveButtonText: {
        color: "#0a0a0f",
        fontSize: 16,
        fontWeight: "700",
    },
});