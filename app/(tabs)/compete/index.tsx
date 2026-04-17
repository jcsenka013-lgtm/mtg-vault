import React, { useState, useCallback } from "react";
import {
    View,
    Text,
    FlatList,
    Pressable,
    Modal,
    StyleSheet,
    Alert,
    ActivityIndicator,
    ScrollView,
    SafeAreaView,
    Platform,
    StatusBar,
    TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import {
    useLeaderboard,
    type LeaderboardEntry,
    type SeasonParticipant,
    type LifetimeEntry,
} from "@/hooks/useLeaderboard";

// ─── Constants ────────────────────────────────────────────────────────────────

const COLOR_META: Record<string, { bg: string; border: string }> = {
    W: { bg: "#e8d880", border: "#c09820" },
    U: { bg: "#3a79c0", border: "#1a59a0" },
    B: { bg: "#7050b0", border: "#5030a0" },
    R: { bg: "#c84030", border: "#a82020" },
    G: { bg: "#309050", border: "#107030" },
    C: { bg: "#909098", border: "#707080" },
};

// The 5 standard MTG colors available to pick
const SELECTABLE_COLORS = ["W", "U", "B", "R", "G"];

const RANK_STYLES: Record<number, { bg: string; text: string }> = {
    1: { bg: "#c89b3c", text: "#0a0a0f" },
    2: { bg: "#9090a8", text: "#0a0a0f" },
    3: { bg: "#a06030", text: "#f0f0f8" },
};

// ─── Small reusable components (defined outside to avoid re-creation) ─────────

function ColorPip({ color, size = 20 }: { color: string; size?: number }) {
    const meta = COLOR_META[color] ?? COLOR_META.C;
    return (
        <View
            style={{
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: meta.bg,
                borderWidth: 1.5,
                borderColor: meta.border,
                alignItems: "center",
                justifyContent: "center",
                marginLeft: 3,
            }}
        >
            <Text
                style={{
                    color: "#fff",
                    fontSize: size * 0.44,
                    fontWeight: "800",
                    lineHeight: size,
                }}
            >
                {color}
            </Text>
        </View>
    );
}

function RankBadge({ rank }: { rank: number }) {
    const s = RANK_STYLES[rank] ?? { bg: "#1a1a26", text: "#606078" };
    return (
        <View style={[styles.rankBadge, { backgroundColor: s.bg }]}>
            <Text style={[styles.rankBadgeText, { color: s.text }]}>{rank}</Text>
        </View>
    );
}

interface PlayerTileProps {
    participant: SeasonParticipant;
    isSelected: boolean;
    isDisabled: boolean;
    onPress: () => void;
}

function PlayerTile({ participant, isSelected, isDisabled, onPress }: PlayerTileProps) {
    return (
        <Pressable
            style={[
                styles.playerTile,
                isSelected && styles.playerTileSelected,
                isDisabled && styles.playerTileDisabled,
            ]}
            onPress={onPress}
            disabled={isDisabled}
        >
            <View
                style={[
                    styles.playerTileAvatar,
                    isSelected && styles.playerTileAvatarSelected,
                    isDisabled && styles.playerTileAvatarDisabled,
                ]}
            >
                <Text
                    style={[
                        styles.playerTileInitial,
                        isSelected && styles.playerTileInitialSelected,
                    ]}
                >
                    {participant.player_name[0]}
                </Text>
            </View>
            <Text
                style={[
                    styles.playerTileName,
                    isSelected && styles.playerTileNameSelected,
                    isDisabled && styles.playerTileNameDisabled,
                ]}
                numberOfLines={1}
            >
                {participant.player_name}
            </Text>
        </Pressable>
    );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function CompeteScreen() {
    const router = useRouter();
    const { leaderboard, activeSeason, participants, lifetimeLeaderboard, loading, error, refresh, startNewSeason } =
        useLeaderboard();
    const [lifetimeMode, setLifetimeMode] = useState(false);

    const currentData = lifetimeMode ? lifetimeLeaderboard : leaderboard;

    // ── Season Manager Modal State ──
    const [managerVisible, setManagerVisible] = useState(false);
    const [newSeasonTitle, setNewSeasonTitle] = useState("");
    const [managingColors, setManagingColors] = useState(false);
    const [seasonSubmitting, setSeasonSubmitting] = useState(false);

    // ── Modal State ───────────────────────────────────────────────────────────
    const [modalVisible, setModalVisible] = useState(false);
    const [winnerId, setWinnerId] = useState<string | null>(null);
    const [loserId, setLoserId] = useState<string | null>(null);
    const [updatingColors, setUpdatingColors] = useState(false);
    const [selectedColors, setSelectedColors] = useState<string[]>([]);
    const [submitting, setSubmitting] = useState(false);

    // ── Handlers ──────────────────────────────────────────────────────────────

    const openModal = useCallback(() => {
        setWinnerId(null);
        setLoserId(null);
        setUpdatingColors(false);
        setSelectedColors([]);
        setModalVisible(true);
    }, []);

    const handleSelectWinner = useCallback(
        (playerId: string) => {
            setWinnerId(playerId);
            // If this player was already the loser, clear loser
            if (loserId === playerId) setLoserId(null);
            // Pre-fill color toggle with their current season colors
            const part = participants.find((p) => p.player_id === playerId);
            setSelectedColors(part?.deck_colors ?? []);
        },
        [loserId, participants]
    );

    const toggleColor = (color: string) => {
        setSelectedColors((prev) =>
            prev.includes(color) ? prev.filter((c) => c !== color) : [...prev, color]
        );
    };

    const handleSubmit = async () => {
        if (!winnerId || !loserId || !activeSeason) return;
        setSubmitting(true);
        try {
            // 1. Insert the match result
            const { error: matchErr } = await supabase.from("matches").insert({
                season_id: activeSeason.id,
                winner_id: winnerId,
                loser_id: loserId,
            });
            if (matchErr) throw matchErr;

            // 2. Optionally update the winner's deck colors for this season
            if (updatingColors) {
                const part = participants.find((p) => p.player_id === winnerId);
                if (part) {
                    const { error: colorErr } = await supabase
                        .from("season_participants")
                        .update({ deck_colors: selectedColors })
                        .eq("id", part.participant_id);
                    if (colorErr) throw colorErr;
                }
            }

            setModalVisible(false);
            await refresh();
        } catch (err: any) {
            Alert.alert("Error", err.message ?? "Failed to record match. Please try again.");
        } finally {
            setSubmitting(false);
        }
    };

    const handleStartNewSeason = async () => {
        if (!newSeasonTitle.trim()) return;
        Alert.alert(
            "End Current Season?",
            `Are you sure you want to end ${activeSeason?.title} and start ${newSeasonTitle}? This will reset all records.`,
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Confirm",
                    style: "destructive",
                    onPress: async () => {
                        setSeasonSubmitting(true);
                        try {
                            await startNewSeason(newSeasonTitle.trim());
                            setNewSeasonTitle("");
                            Alert.alert("Success", "New season started!");
                        } catch (err: any) {
                            Alert.alert("Error", err.message ?? "Failed to start new season.");
                        } finally {
                            setSeasonSubmitting(false);
                        }
                    },
                },
            ]
        );
    };

    const handleUpdateParticipantColors = async (participantId: string, colors: string[]) => {
        try {
            const { error: colorErr } = await supabase
                .from("season_participants")
                .update({ deck_colors: colors })
                .eq("id", participantId);
            if (colorErr) throw colorErr;
            await refresh();
        } catch (err: any) {
            Alert.alert("Error", "Failed to update colors.");
        }
    };

    // ── Derived values ────────────────────────────────────────────────────────

    const winnerParticipant = participants.find((p) => p.player_id === winnerId);
    const loserParticipant = participants.find((p) => p.player_id === loserId);
    const canSubmit = !!winnerId && !!loserId && !submitting;
    const totalMatches = leaderboard.reduce((s, e) => s + Number(e.wins), 0);

    // ── Render helpers ────────────────────────────────────────────────────────

    const renderRow = ({
        item,
        index,
    }: {
        item: any;
        index: number;
    }) => {
        const rank = index + 1;
        const isLeader = rank === 1;
        
        const playerId = item.player_id;
        const playerName = item.player_name;
        
        let wins: number, losses: number, winPct: number | null, deckColors: string[] = [];
        
        if (lifetimeMode) {
            wins = Number(item.lifetime_wins);
            losses = Number(item.lifetime_losses);
            winPct = Number(item.win_percentage);
        } else {
            wins = Number(item.wins);
            losses = Number(item.losses);
            const total = wins + losses;
            winPct = total > 0 ? Math.round((wins / total) * 100) : null;
            deckColors = item.deck_colors || [];
        }

        return (
            <Pressable
                style={[
                    styles.row,
                    isLeader && styles.rowLeader,
                ]}
                onPress={() => router.push(`/compete/player/${playerId}` as any)}
            >
                {/* Rank */}
                <RankBadge rank={rank} />

                {/* Name + Colors */}
                <View style={styles.rowPlayer}>
                    <Text style={[styles.rowName, isLeader && styles.rowNameLeader]}>
                        {playerName}
                    </Text>
                    {!lifetimeMode && deckColors.length > 0 && (
                        <View style={styles.colorPips}>
                            {deckColors.map((c: string) => (
                                <ColorPip key={c} color={c} size={16} />
                            ))}
                        </View>
                    )}
                </View>

                {/* Record */}
                <View style={styles.rowRecord}>
                    <Text style={styles.rowRecordText}>
                        <Text style={styles.winsText}>{wins}W</Text>
                        {"  "}
                        <Text style={styles.lossesText}>{losses}L</Text>
                    </Text>
                    {winPct !== null && winPct > 0 && (
                        <Text style={styles.winPct}>{winPct}%</Text>
                    )}
                    {lifetimeMode && (
                        <Ionicons name="chevron-forward" size={16} color="#404058" />
                    )}
                </View>
            </Pressable>
        );
    };

    // ── Loading / Error states ────────────────────────────────────────────────

    if (loading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator color="#c89b3c" size="large" />
                <Text style={styles.loadingText}>Loading season…</Text>
            </View>
        );
    }

    if (error) {
        return (
            <View style={styles.center}>
                <Text style={styles.errorEmoji}>⚠️</Text>
                <Text style={styles.errorText}>{error}</Text>
                <Pressable style={styles.retryBtn} onPress={refresh}>
                    <Text style={styles.retryBtnText}>Try Again</Text>
                </Pressable>
            </View>
        );
    }

    // ── Main render ───────────────────────────────────────────────────────────

    return (
        <View style={styles.container}>
            <SafeAreaView style={{ backgroundColor: "#12121a" }} />

            {/* ── Season Header ── */}
            <View style={styles.header}>
                <View style={styles.headerEyebrowRow}>
                    {!lifetimeMode && <View style={styles.activeDot} />}
                    <Text style={styles.headerEyebrow}>
                        {lifetimeMode ? "LIFETIME LEGACY" : "ACTIVE SEASON"}
                    </Text>
                </View>
                <Text style={styles.headerTitle}>
                    {lifetimeMode ? "All-Time Champions" : activeSeason?.title ?? "Leaderboard"}
                </Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={styles.headerMeta}>
                        {lifetimeMode 
                            ? `${lifetimeLeaderboard.length} players · all matches`
                            : `${leaderboard.length} players · ${totalMatches} match${totalMatches !== 1 ? 'es' : ''} played`
                        }
                    </Text>
                    <Pressable onPress={() => setManagerVisible(true)}>
                        <Ionicons name="settings" size={24} color="#606078" />
                    </Pressable>
                </View>
                {/* Toggle */}
                <View style={styles.toggleContainer}>
                    <Pressable 
                        style={[styles.toggleBtn, !lifetimeMode && styles.toggleBtnActive]}
                        onPress={() => setLifetimeMode(false)}
                    >
                        <Text style={[styles.toggleText, !lifetimeMode && styles.toggleTextActive]}>
                            Season
                        </Text>
                    </Pressable>
                    <Pressable 
                        style={[styles.toggleBtn, lifetimeMode && styles.toggleBtnActive]}
                        onPress={() => setLifetimeMode(true)}
                    >
                        <Text style={[styles.toggleText, lifetimeMode && styles.toggleTextActive]}>
                            Lifetime
                        </Text>
                    </Pressable>
                </View>
            </View>

            {/* ── Table Column Headers ── */}
            <View style={styles.tableHeader}>
                <View style={{ width: 40 }} />
                <Text style={[styles.tableHeaderText, { flex: 1 }]}>PLAYER</Text>
                <Text style={[styles.tableHeaderText, { textAlign: "right", marginRight: 4 }]}>
                    RECORD
                </Text>
            </View>

            {/* ── Leaderboard ── */}
            <FlatList
                data={currentData}
                keyExtractor={(item) => item.player_id}
                renderItem={renderRow}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyEmoji}>🏆</Text>
                        <Text style={styles.emptyTitle}>No matches yet</Text>
                        <Text style={styles.emptySubtitle}>
                            Hit "Report Match" to record the first game of the season!
                        </Text>
                    </View>
                }
            />

            {/* ── Report Match FAB ── */}
            <Pressable style={styles.fab} onPress={openModal}>
                <Text style={styles.fabText}>+ Report Match</Text>
            </Pressable>

            {/* ── Report Match Modal ── */}
            <Modal
                visible={modalVisible}
                transparent
                animationType="slide"
                onRequestClose={() => setModalVisible(false)}
            >
                <View style={styles.modalBackdrop}>
                    {/* Tap outside to dismiss */}
                    <Pressable
                        style={StyleSheet.absoluteFill}
                        onPress={() => setModalVisible(false)}
                    />

                    <View style={styles.modalSheet}>
                        {/* Handle bar */}
                        <View style={styles.modalHandle} />

                        <Text style={styles.modalTitle}>Report Match</Text>
                        <Text style={styles.modalSubtitle}>
                            Select the winner first, then the loser.
                        </Text>

                        <ScrollView
                            showsVerticalScrollIndicator={false}
                            contentContainerStyle={{ paddingBottom: 24 }}
                        >
                            {/* ── Winner Grid ── */}
                            <Text style={styles.modalSectionLabel}>🏆  WINNER</Text>
                            <View style={styles.playerGrid}>
                                {participants.map((p) => (
                                    <PlayerTile
                                        key={p.player_id}
                                        participant={p}
                                        isSelected={winnerId === p.player_id}
                                        isDisabled={false}
                                        onPress={() => handleSelectWinner(p.player_id)}
                                    />
                                ))}
                            </View>

                            {/* ── Loser Grid ── */}
                            <Text style={[styles.modalSectionLabel, { marginTop: 20 }]}>
                                💀  LOSER
                            </Text>
                            <View style={styles.playerGrid}>
                                {participants.map((p) => (
                                    <PlayerTile
                                        key={p.player_id}
                                        participant={p}
                                        isSelected={loserId === p.player_id}
                                        // Disable the player already picked as winner
                                        isDisabled={p.player_id === winnerId}
                                        onPress={() => setLoserId(p.player_id)}
                                    />
                                ))}
                            </View>

                            {/* ── Optional: Update winner's deck colors ── */}
                            {winnerParticipant && (
                                <View style={styles.colorSection}>
                                    <Pressable
                                        style={styles.colorToggleRow}
                                        onPress={() => setUpdatingColors((v) => !v)}
                                    >
                                        <Text style={styles.colorToggleLabel}>
                                            Update {winnerParticipant.player_name}'s deck colors?
                                        </Text>
                                        <View
                                            style={[
                                                styles.colorTogglePill,
                                                updatingColors && styles.colorTogglePillActive,
                                            ]}
                                        >
                                            <Text style={styles.colorTogglePillText}>
                                                {updatingColors ? "ON" : "OFF"}
                                            </Text>
                                        </View>
                                    </Pressable>

                                    {updatingColors && (
                                        <View style={styles.colorPickerRow}>
                                            {SELECTABLE_COLORS.map((color) => {
                                                const isOn = selectedColors.includes(color);
                                                const meta = COLOR_META[color];
                                                return (
                                                    <Pressable
                                                        key={color}
                                                        style={[
                                                            styles.colorPickerPip,
                                                            {
                                                                backgroundColor: isOn ? meta.bg : "#1a1a26",
                                                                borderColor: isOn ? meta.border : "#333344",
                                                            },
                                                        ]}
                                                        onPress={() => toggleColor(color)}
                                                    >
                                                        <Text
                                                            style={[
                                                                styles.colorPickerLabel,
                                                                { color: isOn ? "#fff" : "#606078" },
                                                            ]}
                                                        >
                                                            {color}
                                                        </Text>
                                                    </Pressable>
                                                );
                                            })}
                                        </View>
                                    )}
                                </View>
                            )}
                        </ScrollView>

                        {/* ── Submit Button ── */}
                        <Pressable
                            style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
                            onPress={handleSubmit}
                            disabled={!canSubmit}
                        >
                            {submitting ? (
                                <ActivityIndicator color="#0a0a0f" />
                            ) : canSubmit ? (
                                <Text style={styles.submitBtnText}>
                                    ✓  {winnerParticipant?.player_name} beat{" "}
                                    {loserParticipant?.player_name}
                                </Text>
                            ) : (
                                <Text style={styles.submitBtnTextDim}>
                                    Select a winner &amp; loser to continue
                                </Text>
                            )}
                        </Pressable>
                    </View>
                </View>
            </Modal>

            {/* ── Season Manager Modal ── */}
            <Modal
                visible={managerVisible}
                transparent
                animationType="slide"
                onRequestClose={() => setManagerVisible(false)}
            >
                <View style={styles.modalBackdrop}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={() => setManagerVisible(false)} />
                    <View style={styles.modalSheet}>
                        <View style={styles.modalHandle} />
                        <Text style={styles.modalTitle}>Season Manager</Text>
                        
                        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24, paddingHorizontal: 4 }}>
                            {/* New Season Form */}
                            <Text style={[styles.modalSectionLabel, { marginTop: 20 }]}>ACTIVE SEASON CONTROLS</Text>
                            <TextInput 
                                style={{ backgroundColor: "#1a1a26", color: "#fff", padding: 16, borderRadius: 12, marginBottom: 16, borderWidth: 1, borderColor: '#333344' }}
                                placeholder="e.g. May 2026 Draft"
                                placeholderTextColor="#606078"
                                value={newSeasonTitle}
                                onChangeText={setNewSeasonTitle}
                            />
                            <Pressable 
                                style={[styles.submitBtn, { backgroundColor: '#ef4444', marginTop: 0 }, !newSeasonTitle.trim() && styles.submitBtnDisabled]}
                                onPress={handleStartNewSeason}
                                disabled={!newSeasonTitle.trim() || seasonSubmitting}
                            >
                                {seasonSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={[styles.submitBtnText, { color: '#fff' }]}>End Current & Start New Season</Text>}
                            </Pressable>

                            {/* Color Assignment */}
                            <Text style={[styles.modalSectionLabel, { marginTop: 32 }]}>COLOR ASSIGNMENT ({activeSeason?.title})</Text>
                            {participants.map(p => (
                                <View key={p.player_id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#222233' }}>
                                    <Text style={{ color: '#f0f0f8', fontSize: 16, fontWeight: '600' }}>{p.player_name}</Text>
                                    <View style={{ flexDirection: 'row', gap: 6 }}>
                                        {SELECTABLE_COLORS.map(color => {
                                            const isOn = p.deck_colors.includes(color);
                                            const meta = COLOR_META[color];
                                            return (
                                                <Pressable
                                                    key={color}
                                                    style={[styles.colorPickerPip, {
                                                        width: 32, height: 32, borderRadius: 16, borderWidth: 1.5,
                                                        backgroundColor: isOn ? meta.bg : "#1a1a26",
                                                        borderColor: isOn ? meta.border : "#333344",
                                                    }]}
                                                    onPress={() => {
                                                        const newColors = isOn ? p.deck_colors.filter(c => c !== color) : [...p.deck_colors, color];
                                                        handleUpdateParticipantColors(p.participant_id, newColors);
                                                    }}
                                                >
                                                    <Text style={[styles.colorPickerLabel, { fontSize: 13, color: isOn ? "#fff" : "#606078" }]}>{color}</Text>
                                                </Pressable>
                                            );
                                        })}
                                    </View>
                                </View>
                            ))}
                        </ScrollView>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#0a0a0f",
    },
    center: {
        flex: 1,
        backgroundColor: "#0a0a0f",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 32,
    },

    // ── Header ──
    header: {
        backgroundColor: "#12121a",
        paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 24) + 12 : 20,
        paddingHorizontal: 20,
        paddingBottom: 20,
        borderBottomWidth: 1,
        borderBottomColor: "#1e1e2e",
    },
    headerEyebrowRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        marginBottom: 6,
    },
    activeDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: "#22c55e",
    },
    headerEyebrow: {
        color: "#606078",
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 1.4,
    },
    headerTitle: {
        color: "#f0f0f8",
        fontSize: 24,
        fontWeight: "800",
        letterSpacing: 0.2,
        marginBottom: 4,
    },
    headerMeta: {
        color: "#606078",
        fontSize: 13,
    },

    // ── Table header row ──
    tableHeader: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: "#0a0a0f",
    },
    tableHeaderText: {
        color: "#404058",
        fontSize: 10,
        fontWeight: "700",
        letterSpacing: 1.2,
    },

    // ── Leaderboard rows ──
    listContent: {
        paddingHorizontal: 12,
        paddingBottom: 100,
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "#12121a",
        borderRadius: 12,
        paddingVertical: 14,
        paddingHorizontal: 12,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: "#1a1a26",
        gap: 10,
    },
    rowLeader: {
        borderColor: "#c89b3c",
        borderWidth: 1.5,
        backgroundColor: "#15130a",
    },
    rankBadge: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
    },
    rankBadgeText: {
        fontSize: 14,
        fontWeight: "800",
    },
    rowPlayer: {
        flex: 1,
        gap: 4,
    },
    rowName: {
        color: "#f0f0f8",
        fontSize: 16,
        fontWeight: "700",
    },
    rowNameLeader: {
        color: "#e8c860",
    },
    colorPips: {
        flexDirection: "row",
        alignItems: "center",
    },
    rowRecord: {
        alignItems: "flex-end",
        gap: 2,
    },
    rowRecordText: {
        fontSize: 14,
        fontWeight: "700",
    },
    winsText: {
        color: "#22c55e",
    },
    lossesText: {
        color: "#ef4444",
    },
    winPct: {
        color: "#606078",
        fontSize: 11,
        fontWeight: "600",
    },

    // ── Empty state ──
    emptyState: {
        alignItems: "center",
        paddingTop: 60,
        paddingHorizontal: 32,
        gap: 10,
    },
    emptyEmoji: {
        fontSize: 48,
    },
    emptyTitle: {
        color: "#f0f0f8",
        fontSize: 18,
        fontWeight: "700",
        textAlign: "center",
    },
    emptySubtitle: {
        color: "#606078",
        fontSize: 14,
        textAlign: "center",
        lineHeight: 20,
    },

    // ── Error state ──
    errorEmoji: { fontSize: 40 },
    errorText: {
        color: "#ef4444",
        fontSize: 15,
        textAlign: "center",
    },
    loadingText: {
        color: "#a0a0b8",
        fontSize: 14,
        marginTop: 8,
    },
    retryBtn: {
        backgroundColor: "#1a1a26",
        borderRadius: 10,
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderWidth: 1,
        borderColor: "#333344",
        marginTop: 8,
    },
    retryBtnText: {
        color: "#c89b3c",
        fontWeight: "700",
        fontSize: 14,
    },

    // ── Toggle ──
    toggleContainer: {
        flexDirection: "row",
        backgroundColor: "#1a1a26",
        borderRadius: 10,
        padding: 4,
        marginTop: 16,
        gap: 4,
    },
    toggleBtn: {
        flex: 1,
        paddingVertical: 10,
        borderRadius: 8,
        alignItems: "center",
    },
    toggleBtnActive: {
        backgroundColor: "#c89b3c",
    },
    toggleText: {
        color: "#606078",
        fontSize: 13,
        fontWeight: "700",
    },
    toggleTextActive: {
        color: "#0a0a0f",
    },

    // ── FAB ──
    fab: {
        position: "absolute",
        bottom: 28,
        right: 20,
        left: 20,
        backgroundColor: "#c89b3c",
        borderRadius: 16,
        paddingVertical: 16,
        alignItems: "center",
        justifyContent: "center",
        shadowColor: "#c89b3c",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 10,
        elevation: 8,
    },
    fabText: {
        color: "#0a0a0f",
        fontSize: 16,
        fontWeight: "800",
        letterSpacing: 0.3,
    },

    // ── Modal ──
    modalBackdrop: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.7)",
        justifyContent: "flex-end",
    },
    modalSheet: {
        backgroundColor: "#12121a",
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingHorizontal: 20,
        paddingBottom: Platform.OS === "ios" ? 40 : 28,
        maxHeight: "90%",
        borderTopWidth: 1,
        borderColor: "#1e1e2e",
    },
    modalHandle: {
        width: 40,
        height: 4,
        borderRadius: 2,
        backgroundColor: "#333344",
        alignSelf: "center",
        marginTop: 12,
        marginBottom: 20,
    },
    modalTitle: {
        color: "#f0f0f8",
        fontSize: 22,
        fontWeight: "800",
        marginBottom: 4,
    },
    modalSubtitle: {
        color: "#606078",
        fontSize: 14,
        marginBottom: 20,
    },
    modalSectionLabel: {
        color: "#c89b3c",
        fontSize: 11,
        fontWeight: "800",
        letterSpacing: 1.3,
        marginBottom: 10,
    },

    // ── Player tile grid ──
    playerGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },
    playerTile: {
        width: "30%",
        // 3 tiles per row, accounting for gap
        flexGrow: 1,
        alignItems: "center",
        paddingVertical: 12,
        paddingHorizontal: 4,
        backgroundColor: "#1a1a26",
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: "#222233",
        gap: 6,
    },
    playerTileSelected: {
        backgroundColor: "rgba(200,155,60,0.12)",
        borderColor: "#c89b3c",
    },
    playerTileDisabled: {
        opacity: 0.3,
    },
    playerTileAvatar: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: "#222233",
        alignItems: "center",
        justifyContent: "center",
    },
    playerTileAvatarSelected: {
        backgroundColor: "#c89b3c",
    },
    playerTileAvatarDisabled: {
        backgroundColor: "#111122",
    },
    playerTileInitial: {
        color: "#a0a0b8",
        fontSize: 18,
        fontWeight: "800",
    },
    playerTileInitialSelected: {
        color: "#0a0a0f",
    },
    playerTileName: {
        color: "#a0a0b8",
        fontSize: 12,
        fontWeight: "600",
        textAlign: "center",
    },
    playerTileNameSelected: {
        color: "#f0f0f8",
        fontWeight: "700",
    },
    playerTileNameDisabled: {
        color: "#333344",
    },

    // ── Color update section ──
    colorSection: {
        marginTop: 20,
        backgroundColor: "#1a1a26",
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "#222233",
        overflow: "hidden",
    },
    colorToggleRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 14,
        paddingVertical: 14,
    },
    colorToggleLabel: {
        color: "#a0a0b8",
        fontSize: 14,
        fontWeight: "600",
        flex: 1,
        marginRight: 12,
    },
    colorTogglePill: {
        backgroundColor: "#222233",
        borderRadius: 20,
        paddingHorizontal: 12,
        paddingVertical: 5,
        borderWidth: 1,
        borderColor: "#333344",
    },
    colorTogglePillActive: {
        backgroundColor: "rgba(200,155,60,0.15)",
        borderColor: "#c89b3c",
    },
    colorTogglePillText: {
        color: "#606078",
        fontSize: 11,
        fontWeight: "800",
        letterSpacing: 0.8,
    },
    colorPickerRow: {
        flexDirection: "row",
        justifyContent: "space-around",
        paddingHorizontal: 14,
        paddingBottom: 16,
        gap: 8,
    },
    colorPickerPip: {
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 2,
        alignItems: "center",
        justifyContent: "center",
    },
    colorPickerLabel: {
        fontSize: 15,
        fontWeight: "800",
    },

    // ── Submit button ──
    submitBtn: {
        backgroundColor: "#c89b3c",
        borderRadius: 14,
        paddingVertical: 16,
        alignItems: "center",
        marginTop: 16,
    },
    submitBtnDisabled: {
        backgroundColor: "#1a1a26",
        borderWidth: 1,
        borderColor: "#222233",
    },
    submitBtnText: {
        color: "#0a0a0f",
        fontSize: 16,
        fontWeight: "800",
        letterSpacing: 0.2,
    },
    submitBtnTextDim: {
        color: "#404058",
        fontSize: 14,
        fontWeight: "600",
    },
});
