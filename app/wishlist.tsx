import { useState, useCallback } from "react";
import {
    View,
    Text,
    FlatList,
    Pressable,
    StyleSheet,
    Alert,
    TextInput,
    Modal,
    ScrollView,
} from "react-native";
import { router, useSegments } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppStore } from "@/store/appStore";
import { useAuthStore } from "@/store/authStore";
import { getWishlistItems, addWishlistItem, removeWishlistItem, updateWishlistItem } from "@/db/queries";
import { themes } from "@/theme";

const RARITY_COLORS: Record<string, string> = {
    mythic: "#e87a3c",
    rare: "#e8c060",
    uncommon: "#8ab4c4",
    common: "#a0a0b0",
};

interface WishlistItem {
    id: string;
    card_id: string | null;
    scryfall_id: string;
    name: string;
    set_code: string | null;
    set_name: string | null;
    collector_number: string | null;
    rarity: string | null;
    price_target: number | null;
    is_foil: boolean;
    condition: string;
    created_at: string;
    updated_at: string;
}

export default function WishlistScreen() {
    const insets = useSafeAreaInsets();
    const { activeTheme } = useAppStore();
    const t = themes[activeTheme];

    const [wishlist, setWishlist] = useState<WishlistItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [editingItem, setEditingItem] = useState<WishlistItem | null>(null);
    const [showModal, setShowModal] = useState(false);
    const [modalError, setModalError] = useState<string | null>(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const items = await getWishlistItems();
            setWishlist(items);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, []);

    // Load data on mount and when focused
    React.useEffect(() => {
        const unsubscribe = router.events?.subscribe(() => {
            loadData();
        });
        return () => unsubscribe?.();
    }, [loadData]);

    const handleAddPress = () => {
        setShowModal(true);
        setEditingItem(null);
    };

    const handleEditPress = (item: WishlistItem) => {
        setShowModal(true);
        setEditingItem(item);
    };

    const handleSavePress = async () => {
        if (!editingItem) return;

        try {
            await updateWishlistItem(editingItem.id, {
                priceTarget: editingItem.price_target,
                isFoil: editingItem.is_foil,
                condition: editingItem.condition,
            });
            setShowModal(false);
            setEditingItem(null);
            loadData();
        } catch (e) {
            setModalError(String(e));
        }
    };

    const handleDeletePress = async (id: string) => {
        try {
            await removeWishlistItem(id);
            loadData();
        } catch (e) {
            Alert.alert("Error", String(e));
        }
    };

    const handleAddItem = async (item: {
        scryfallId: string;
        name: string;
        setCode?: string;
        setName?: string;
        collectorNumber?: string;
        rarity?: string;
        priceTarget?: number;
        isFoil?: boolean;
        condition?: string;
    }) => {
        try {
            await addWishlistItem(item);
            setShowModal(false);
            loadData();
        } catch (e) {
            setModalError(String(e));
        }
    };

    const renderItem = ({ item }: { item: WishlistItem }) => (
        <View style={styles.item}>
            <Pressable style={styles.itemContent} onPress={() => handleEditPress(item)}>
                <View style={styles.itemHeader}>
                    <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.itemSet}>
                        {item.set_code?.toUpperCase() ?? "Unknown"} {item.collector_number ?? ""}
                    </Text>
                </View>
                <View style={styles.itemDetails}>
                    <Text style={[styles.itemRarity, { color: RARITY_COLORS[item.rarity as string] ?? "#a0a0b8" }]}>
                        {item.rarity?.charAt(0).toUpperCase() + (item.rarity?.slice(1) ?? "")}
                    </Text>
                    <View style={styles.priceRow}>
                        <Text style={styles.priceLabel}>Target:</Text>
                        <Text style={styles.priceValue}>{item.price_target != null ? `$${item.price_target.toFixed(2)}` : "—"}</Text>
                    </View>
                    <View style={styles.conditionRow}>
                        <Text style={styles.conditionLabel}>Cond:</Text>
                        <Text style={styles.conditionValue}>{item.condition}</Text>
                    </View>
                    <View style={styles.foilRow}>
                        <Text style={styles.foilLabel}>Foil:</Text>
                        <Text style={styles.foilValue}>{item.is_foil ? "✨" : "No"}</Text>
                    </View>
                </View>
            </Pressable>
            <Pressable style={styles.deleteButton} onPress={() => handleDeletePress(item.id)}>
                <Text style={styles.deleteButtonText}>✕</Text>
            </Pressable>
        </View>
    );

    return (
        <View style={[styles.container, { backgroundColor: t.background }]}>
            <View style={{ paddingTop: insets.top + 20, paddingHorizontal: 16 }}>
                <Text style={styles.headerTitle}>Wishlist</Text>
                <Text style={styles.headerSubtitle}>Track cards you want to acquire</Text>
            </View>

            {loading ? (
                <ActivityIndicator color="#c89b3c" style={{ marginTop: 40 }} />
            ) : (
                <FlatList
                    data={wishlist}
                    keyExtractor={(item) => item.id}
                    renderItem={renderItem}
                    contentContainerStyle={styles.list}
                    style={styles.list}
                    ListEmptyComponent={
                        <View style={styles.emptyState}>
                            <Text style={styles.emptyEmoji}>📝</Text>
                            <Text style={styles.emptyTitle}>Your wishlist is empty</Text>
                            <Text style={styles.emptySubtitle}>Start adding cards you're looking for</Text>
                        </View>
                    }
                />
            )}

            <Pressable style={[styles.fab, { backgroundColor: t.primary }]} onPress={handleAddPress}>
                <Text style={styles.fabText}>+</Text>
            </Pressable>

            {/* Add/Edit Modal */}
            <Modal visible={showModal} animationType="slide">
                <ScrollView style={[styles.modalContainer, { backgroundColor: t.background }]}>
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>
                            {editingItem ? `Edit ${editingItem.name}` : "Add to Wishlist"}
                        </Text>
                        {modalError && <Text style={styles.modalError}>{modalError}</Text>}
                        <Text style={styles.inputLabel}>Card Name</Text>
                        <TextInput
                            style={styles.textInput}
                            value={editingItem?.name ?? ""}
                            editable={false}
                            placeholderTextColor="#606078"
                        />
                        <Text style={styles.inputLabel}>Set Code</Text>
                        <TextInput
                            style={styles.textInput}
                            value={editingItem?.set_code ?? ""}
                            editable={false}
                            placeholderTextColor="#606078"
                        />
                        <Text style={styles.inputLabel}>Collector Number</Text>
                        <TextInput
                            style={styles.textInput}
                            value={editingItem?.collector_number ?? ""}
                            editable={false}
                            placeholderTextColor="#606078"
                        />
                        <Text style={styles.inputLabel}>Rarity</Text>
                        <TextInput
                            style={styles.textInput}
                            value={editingItem?.rarity ?? ""}
                            editable={false}
                            placeholderTextColor="#606078"
                        />
                        <Text style={styles.inputLabel}>Target Price ($)</Text>
                        <TextInput
                            style={styles.textInput}
                            value={editingItem?.price_target?.toString() ?? ""}
                            onChangeText={(text) => {
                                if (editingItem) {
                                    editingItem.price_target = text ? parseFloat(text) : null;
                                }
                            }}
                            keyboardType="numeric"
                            placeholder="$0.00"
                            placeholderTextColor="#606078"
                        />
                        <View style={styles.foilConditionRow}>
                            <View style={styles.foilContainer}>
                                <Text style={styles.inputLabel}>Foil</Text>
                                <Pressable
                                    style={[styles.toggle, { backgroundColor: editingItem?.is_foil ? t.primary : "#1a1a26" }]}
                                    onPress={() => {
                                        if (editingItem) editingItem.is_foil = !editingItem.is_foil;
                                    }}
                                >
                                    <Text style={styles.toggleText}>{editingItem?.is_foil ? "✨" : "No"}</Text>
                                </Pressable>
                            </View>
                            <View style={styles.conditionContainer}>
                                <Text style={styles.inputLabel}>Condition</Text>
                                <TextInput
                                    style={styles.textInput}
                                    value={editingItem?.condition ?? ""}
                                    onChangeText={(text) => {
                                        if (editingItem) editingItem.condition = text;
                                    }}
                                    placeholder="NM, LP, MP, HP, DMG"
                                    placeholderTextColor="#606078"
                                />
                            </View>
                        </View>
                        <View style={styles.buttonRow}>
                            <Pressable style={[styles.cancelButton, { borderColor: t.border }]} onPress={() => setShowModal(false)}>
                                <Text style={[styles.cancelButtonText, { color: t.text }]}>Cancel</Text>
                            </Pressable>
                            <Pressable style={[styles.saveButton, { backgroundColor: t.primary }]} onPress={handleSavePress}>
                                <Text style={styles.saveButtonText}>Save</Text>
                            </Pressable>
                        </View>
                    </View>
                </ScrollView>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingTop: 60,
    },
    headerTitle: {
        color: "#f0f0f8",
        fontSize: 24,
        fontWeight: "700",
        marginBottom: 8,
    },
    headerSubtitle: {
        color: "#a0a0b8",
        fontSize: 14,
        fontWeight: "400",
    },
    list: {
        paddingBottom: 120,
    },
    item: {
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "#12121a",
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: "#222233",
    },
    itemContent: {
        flex: 1,
        marginRight: 12,
    },
    itemHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 8,
    },
    itemName: {
        color: "#f0f0f8",
        fontSize: 16,
        fontWeight: "700",
        flex: 1,
    },
    itemSet: {
        color: "#a0a0b8",
        fontSize: 12,
        fontWeight: "600",
        marginLeft: 8,
    },
    itemDetails: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        flex: 1,
    },
    itemRarity: {
        fontSize: 12,
        fontWeight: "600",
        textTransform: "uppercase",
        minWidth: 60,
    },
    priceRow: {
        alignItems: "center",
        marginRight: 16,
    },
    priceLabel: {
        color: "#606078",
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginBottom: 2,
    },
    priceValue: {
        color: "#c89b3c",
        fontSize: 14,
        fontWeight: "700",
    },
    conditionRow: {
        alignItems: "center",
        marginRight: 16,
    },
    conditionLabel: {
        color: "#606078",
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginBottom: 2,
    },
    conditionValue: {
        color: "#a0a0b8",
        fontSize: 12,
        fontWeight: "600",
    },
    foilRow: {
        alignItems: "center",
    },
    foilLabel: {
        color: "#606078",
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginBottom: 2,
    },
    foilValue: {
        color: "#f0f0f8",
        fontSize: 14,
        fontWeight: "700",
    },
    deleteButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: "rgba(239, 68, 68, 0.15)",
        alignItems: "center",
        justifyContent: "center",
    },
    deleteButtonText: {
        color: "#ef4444",
        fontSize: 16,
        fontWeight: "700",
    },
    fab: {
        position: "absolute",
        bottom: 32,
        right: 24,
        width: 56,
        height: 56,
        borderRadius: 28,
        alignItems: "center",
        justifyContent: "center",
        elevation: 4,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
    },
    fabText: {
        color: "#0a0a0f",
        fontSize: 24,
        fontWeight: "700",
    },
    emptyState: {
        alignItems: "center",
        justifyContent: "center",
        marginTop: 60,
    },
    emptyEmoji: {
        fontSize: 48,
        marginBottom: 12,
    },
    emptyTitle: {
        color: "#f0f0f8",
        fontSize: 20,
        fontWeight: "700",
        marginBottom: 8,
        textAlign: "center",
    },
    emptySubtitle: {
        color: "#a0a0b8",
        fontSize: 14,
        textAlign: "center",
        lineHeight: 20,
    },
    modalContainer: {
        flex: 1,
        paddingTop: 60,
    },
    modalContent: {
        padding: 24,
    },
    modalTitle: {
        color: "#f0f0f8",
        fontSize: 24,
        fontWeight: "700",
        marginBottom: 24,
    },
    modalError: {
        color: "#ef4444",
        fontSize: 12,
        fontWeight: "600",
        marginBottom: 12,
        textAlign: "center",
    },
    inputLabel: {
        color: "#a0a0b8",
        fontSize: 12,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginBottom: 6,
    },
    textInput: {
        backgroundColor: "#1a1a26",
        borderRadius: 8,
        padding: 12,
        color: "#f0f0f8",
        fontSize: 16,
        fontWeight: "400",
        marginBottom: 16,
        borderWidth: 1,
        borderColor: "#222233",
    },
    foilConditionRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        marginBottom: 16,
    },
    foilContainer: {
        flex: 1,
        marginRight: 8,
    },
    conditionContainer: {
        flex: 2,
    },
    toggle: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#1a1a26",
        borderWidth: 1,
        borderColor: "#222233",
        borderRadius: 8,
        padding: 12,
        marginTop: 4,
    },
    toggleText: {
        color: "#f0f0f8",
        fontSize: 16,
        fontWeight: "700",
    },
    buttonRow: {
        flexDirection: "row",
        marginTop: 24,
    },
    cancelButton: {
        flex: 1,
        marginRight: 8,
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        alignItems: "center",
    },
    cancelButtonText: {
        color: "#a0a0b8",
        fontSize: 16,
        fontWeight: "600",
    },
    saveButton: {
        flex: 1,
        marginLeft: 8,
        padding: 12,
        borderRadius: 8,
        alignItems: "center",
    },
    saveButtonText: {
        color: "#0a0a0f",
        fontSize: 16,
        fontWeight: "600",
    },
});