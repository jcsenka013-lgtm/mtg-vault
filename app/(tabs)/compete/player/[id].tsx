import React, { useState, useEffect } from "react";
import {
    View,
    Text,
    ScrollView,
    Pressable,
    StyleSheet,
    ActivityIndicator,
    SafeAreaView,
    Platform,
    StatusBar,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";

const COLOR_META: Record<string, { bg: string; border: string }> = {
    W: { bg: "#e8d880", border: "#c09820" },
    U: { bg: "#3a79c0", border: "#1a59a0" },
    B: { bg: "#7050b0", border: "#5030a0" },
    R: { bg: "#c84030", border: "#a82020" },
    G: { bg: "#309050", border: "#107030" },
    C: { bg: "#909098", border: "#707080" },
};

interface PlayerProfile {
    player_id: string;
    player_name: string;
    lifetime_wins: number;
    lifetime_losses: number;
    win_percentage: number;
    favorite_colors: string[];
    rivalry_matrix: Array<{
        opponent_id: string;
        opponent_name: string;
        wins_against: number;
        losses_against: number;
    }>;
    nemesis_name: string;
    nemesis_losses: number;
    victim_name: string;
    victim_wins: number;
}

interface SeasonDraft {
    season_title: string;
    deck_colors: string[];
    wins: number;
    losses: number;
}

export default function PlayerProfileScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const [profile, setProfile] = useState<PlayerProfile | null>(null);
    const [drafts, setDrafts] = useState<SeasonDraft[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchProfile() {
            if (!id) return;
            setLoading(true);
            setError(null);
            try {
                const { data, error: err } = await supabase.rpc("get_player_profile", {
                    p_id: id,
                });
                if (err) throw err;
                if (data && data.length > 0) {
                    setProfile(data[0] as PlayerProfile);
                }

                const { data: draftData, error: draftErr } = await supabase
                    .from("season_participants")
                    .select("seasons(title), deck_colors, player_id")
                    .eq("player_id", id)
                    .order("created_at", { ascending: false })
                    .limit(10);

                if (draftErr) throw draftErr;

                const draftsWithRecords: SeasonDraft[] = [];
                for (const d of draftData || []) {
                    const seasonTitle = (d as any).seasons?.title || "Unknown";
                    const deckColors = (d.deck_colors || []) as string[];
                    const playerId = d.player_id;

                    const { data: matches } = await supabase
                        .from("matches")
                        .select("winner_id, loser_id")
                        .or(`winner_id.eq.${playerId},loser_id.eq.${playerId}`);

                    const wins = (matches || []).filter(
                        (m) => m.winner_id === playerId
                    ).length;
                    const losses = (matches || []).filter(
                        (m) => m.loser_id === playerId
                    ).length;

                    draftsWithRecords.push({
                        season_title: seasonTitle,
                        deck_colors: deckColors,
                        wins,
                        losses,
                    });
                }
                setDrafts(draftsWithRecords);
            } catch (err: any) {
                setError(err.message ?? "Failed to load player profile.");
            } finally {
                setLoading(false);
            }
        }
        fetchProfile();
    }, [id]);

    if (loading) {
        return (
            <View style={styles.container}>
                <SafeAreaView style={{ backgroundColor: "#12121a" }} />
                <View style={styles.center}>
                    <ActivityIndicator color="#c89b3c" size="large" />
                    <Text style={styles.loadingText}>Loading profile…</Text>
                </View>
            </View>
        );
    }

    if (error || !profile) {
        return (
            <View style={styles.container}>
                <SafeAreaView style={{ backgroundColor: "#12121a" }} />
                <View style={styles.center}>
                    <Text style={styles.errorEmoji}>⚠️</Text>
                    <Text style={styles.errorText}>{error || "Player not found"}</Text>
                    <Pressable style={styles.retryBtn} onPress={() => router.back()}>
                        <Text style={styles.retryBtnText}>Go Back</Text>
                    </Pressable>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <SafeAreaView style={{ backgroundColor: "#12121a" }} />
            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {/* Header */}
                <View style={styles.header}>
                    <Pressable style={styles.backBtn} onPress={() => router.back()}>
                        <Ionicons name="arrow-back" size={24} color="#f0f0f8" />
                    </Pressable>
                </View>

                {/* Profile Hero */}
                <View style={styles.hero}>
                    <View style={styles.avatar}>
                        <Text style={styles.avatarInitial}>
                            {profile.player_name[0]}
                        </Text>
                    </View>
                    <Text style={styles.playerName}>{profile.player_name}</Text>
                    <Text style={styles.winPctHero}>
                        {profile.win_percentage}% Lifetime Win Rate
                    </Text>
                    <Text style={styles.recordHero}>
                        {profile.lifetime_wins}W — {profile.lifetime_losses}L
                    </Text>
                </View>

                {/* Favorite Colors */}
                {profile.favorite_colors && profile.favorite_colors.length > 0 && (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Favorite Colors</Text>
                        <View style={styles.colorRow}>
                            {profile.favorite_colors.map((c) => {
                                const meta = COLOR_META[c] ?? COLOR_META.C;
                                return (
                                    <View
                                        key={c}
                                        style={[
                                            styles.colorPip,
                                            {
                                                backgroundColor: meta.bg,
                                                borderColor: meta.border,
                                            },
                                        ]}
                                    >
                                        <Text style={styles.colorPipText}>{c}</Text>
                                    </View>
                                );
                            })}
                        </View>
                    </View>
                )}

                {/* Rivalry Section - Most Important */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Rivalry</Text>
                    
                    {/* Nemesis */}
                    {profile.nemesis_name && profile.nemesis_name !== "None" && (
                        <View style={styles.rivalCard}>
                            <View style={styles.rivalHeader}>
                                <Ionicons name="skull" size={20} color="#ef4444" />
                                <Text style={styles.rivalLabel}>Nemesis</Text>
                            </View>
                            <Text style={styles.rivalName}>
                                {profile.nemesis_name}
                            </Text>
                            <Text style={styles.rivalStat}>
                                Has beaten you {profile.nemesis_losses} time
                                {profile.nemesis_losses !== 1 ? "s" : ""}
                            </Text>
                        </View>
                    )}

                    {/* Favorite Victim */}
                    {profile.victim_name && profile.victim_name !== "None" && (
                        <View style={[styles.rivalCard, styles.rivalCardVictim]}>
                            <View style={styles.rivalHeader}>
                                <Ionicons name="trophy" size={20} color="#22c55e" />
                                <Text style={[styles.rivalLabel, styles.rivalLabelVictim]}>
                                    Favorite Victim
                                </Text>
                            </View>
                            <Text style={[styles.rivalName, styles.rivalNameVictim]}>
                                {profile.victim_name}
                            </Text>
                            <Text style={[styles.rivalStat, styles.rivalStatVictim]}>
                                You've beaten them {profile.victim_wins} time
                                {profile.victim_wins !== 1 ? "s" : ""}
                            </Text>
                        </View>
                    )}

                    {(!profile.nemesis_name || profile.nemesis_name === "None") && 
                     (!profile.victim_name || profile.victim_name === "None") && (
                        <Text style={styles.noRivals}>No rivalries yet — play more matches!</Text>
                    )}
                </View>

                {/* Head-to-Head Grid */}
                {profile.rivalry_matrix && profile.rivalry_matrix.length > 0 && (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Head-to-Head</Text>
                        <View style={styles.matchupGrid}>
                            {profile.rivalry_matrix
                                .filter((r) => r.wins_against > 0 || r.losses_against > 0)
                                .map((r) => (
                                    <View key={r.opponent_id} style={styles.matchupCard}>
                                        <Text style={styles.matchupOpponent}>
                                            {r.opponent_name}
                                        </Text>
                                        <View style={styles.matchupRecord}>
                                            <Text style={styles.matchupWins}>
                                                {r.wins_against}W
                                            </Text>
                                            <Text style={styles.matchupSep}>-</Text>
                                            <Text style={styles.matchupLosses}>
                                                {r.losses_against}L
                                            </Text>
                                        </View>
                                    </View>
                                ))}
                        </View>
                    </View>
                )}

                {/* Season History */}
                {drafts.length > 0 && (
                    <View style={[styles.section, styles.sectionLast]}>
                        <Text style={styles.sectionTitle}>Season History</Text>
                        {drafts.map((draft, idx) => (
                            <View key={idx} style={styles.draftRow}>
                                <View style={styles.draftInfo}>
                                    <Text style={styles.draftTitle}>{draft.season_title}</Text>
                                    <View style={styles.draftColors}>
                                        {draft.deck_colors.map((c) => {
                                            const meta = COLOR_META[c] ?? COLOR_META.C;
                                            return (
                                                <View
                                                    key={c}
                                                    style={[
                                                        styles.draftColorPip,
                                                        {
                                                            backgroundColor: meta.bg,
                                                            borderColor: meta.border,
                                                        },
                                                    ]}
                                                />
                                            );
                                        })}
                                    </View>
                                </View>
                                <Text style={styles.draftRecord}>
                                    {draft.wins}-{draft.losses}
                                </Text>
                            </View>
                        ))}
                    </View>
                )}
            </ScrollView>
        </View>
    );
}

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
    scrollContent: {
        paddingBottom: 40,
    },
    loadingText: {
        color: "#a0a0b8",
        fontSize: 14,
        marginTop: 8,
    },
    errorEmoji: { fontSize: 40 },
    errorText: {
        color: "#ef4444",
        fontSize: 15,
        textAlign: "center",
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

    // Header
    header: {
        backgroundColor: "#12121a",
        paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 24) + 12 : 20,
        paddingHorizontal: 16,
        paddingBottom: 8,
    },
    backBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: "#1a1a26",
        alignItems: "center",
        justifyContent: "center",
    },

    // Hero
    hero: {
        alignItems: "center",
        paddingVertical: 24,
        backgroundColor: "#12121a",
        borderBottomWidth: 1,
        borderBottomColor: "#1a1a26",
    },
    avatar: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: "#c89b3c",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 16,
    },
    avatarInitial: {
        color: "#0a0a0f",
        fontSize: 36,
        fontWeight: "800",
    },
    playerName: {
        color: "#f0f0f8",
        fontSize: 28,
        fontWeight: "800",
        marginBottom: 4,
    },
    winPctHero: {
        color: "#c89b3c",
        fontSize: 18,
        fontWeight: "700",
        marginBottom: 2,
    },
    recordHero: {
        color: "#606078",
        fontSize: 14,
        fontWeight: "600",
    },

    // Sections
    section: {
        paddingHorizontal: 16,
        paddingTop: 24,
    },
    sectionLast: {
        paddingBottom: 24,
    },
    sectionTitle: {
        color: "#c89b3c",
        fontSize: 11,
        fontWeight: "800",
        letterSpacing: 1.4,
        marginBottom: 12,
    },

    // Colors
    colorRow: {
        flexDirection: "row",
        gap: 8,
    },
    colorPip: {
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 2,
        alignItems: "center",
        justifyContent: "center",
    },
    colorPipText: {
        color: "#fff",
        fontSize: 16,
        fontWeight: "800",
    },

    // Rivalry
    rivalCard: {
        backgroundColor: "#1a1a26",
        borderRadius: 12,
        padding: 16,
        borderWidth: 1,
        borderColor: "#3a1a1a",
        marginBottom: 12,
    },
    rivalCardVictim: {
        borderColor: "#1a3a1a",
    },
    rivalHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        marginBottom: 8,
    },
    rivalLabel: {
        color: "#ef4444",
        fontSize: 12,
        fontWeight: "700",
        letterSpacing: 0.8,
    },
    rivalLabelVictim: {
        color: "#22c55e",
    },
    rivalName: {
        color: "#f0f0f8",
        fontSize: 20,
        fontWeight: "800",
        marginBottom: 4,
    },
    rivalNameVictim: {
        color: "#22c55e",
    },
    rivalStat: {
        color: "#606078",
        fontSize: 14,
    },
    rivalStatVictim: {
        color: "#a0b8a0",
    },
    noRivals: {
        color: "#606078",
        fontSize: 14,
        fontStyle: "italic",
    },

    // Matchup Grid
    matchupGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },
    matchupCard: {
        backgroundColor: "#1a1a26",
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderWidth: 1,
        borderColor: "#222233",
        minWidth: "30%",
        flexGrow: 1,
    },
    matchupOpponent: {
        color: "#a0a0b8",
        fontSize: 13,
        fontWeight: "600",
        marginBottom: 4,
    },
    matchupRecord: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    matchupWins: {
        color: "#22c55e",
        fontSize: 15,
        fontWeight: "800",
    },
    matchupSep: {
        color: "#404058",
        fontSize: 15,
    },
    matchupLosses: {
        color: "#ef4444",
        fontSize: 15,
        fontWeight: "800",
    },

    // Draft History
    draftRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: "#1a1a26",
    },
    draftInfo: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    draftTitle: {
        color: "#f0f0f8",
        fontSize: 14,
        fontWeight: "600",
    },
    draftColors: {
        flexDirection: "row",
        gap: 4,
    },
    draftColorPip: {
        width: 16,
        height: 16,
        borderRadius: 8,
        borderWidth: 1,
    },
    draftRecord: {
        color: "#606078",
        fontSize: 14,
        fontWeight: "600",
    },
});