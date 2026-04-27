import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, SafeAreaView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTournament, type BracketMatch } from '@/hooks/useTournament';

function MatchCard({
  match,
  interactive,
  reportWinner,
}: {
  match: BracketMatch;
  interactive: boolean;
  reportWinner: (matchId: string, winnerId: string) => void;
}) {
  const isComplete = match.winner_id !== null;
  const isPlayable = !!(match.player1_id && match.player2_id && !isComplete);
  const canTap = interactive && isPlayable;

  return (
    <View style={styles.matchCard}>
      <Pressable
        style={[styles.matchSlot, match.winner_id === match.player1_id && styles.matchSlotWinner, !match.player1_id && styles.matchSlotEmpty]}
        onPress={() => { if (canTap && match.player1_id) reportWinner(match.match_id, match.player1_id); }}
        disabled={!canTap || !match.player1_id}
      >
        <View style={styles.slotInner}>
          {match.player1_name ? (
            <>
              <Text style={[styles.slotName, match.winner_id === match.player1_id && styles.slotNameWinner]} numberOfLines={1}>{match.player1_name}</Text>
              {isComplete && match.winner_id === match.player1_id && <Ionicons name='checkmark-circle' size={14} color='#22c55e' />}
            </>
          ) : (
            <Text style={styles.slotEmptyText}>TBD</Text>
          )}
        </View>
      </Pressable>
      <View style={styles.matchDivider} />
      <Pressable
        style={[styles.matchSlot, match.winner_id === match.player2_id && styles.matchSlotWinner, !match.player2_id && styles.matchSlotEmpty]}
        onPress={() => { if (canTap && match.player2_id) reportWinner(match.match_id, match.player2_id); }}
        disabled={!canTap || !match.player2_id}
      >
        <View style={styles.slotInner}>
          {match.player2_name ? (
            <>
              <Text style={[styles.slotName, match.winner_id === match.player2_id && styles.slotNameWinner]} numberOfLines={1}>{match.player2_name}</Text>
              {isComplete && match.winner_id === match.player2_id && <Ionicons name='checkmark-circle' size={14} color='#22c55e' />}
            </>
          ) : (
            <Text style={styles.slotEmptyText}>TBD</Text>
          )}
        </View>
      </Pressable>
    </View>
  );
}

export default function BracketScreen() {
  const router = useRouter();
  const {
    players,
    activeTournament,
    pastTournaments,
    loading,
    error,
    refresh,
    toggleAvailability,
    createBracket,
    shuffleBracket,
    reportWinner,
    canOrganize,
    isSpectatorView,
  } = useTournament();
  const [setupMode, setSetupMode] = useState(!activeTournament);

  const availableCount = players.filter((p) => p.available).length;

  const totalRounds = useMemo(() => {
    if (!activeTournament) return 2;
    return Math.max(...activeTournament.matches.map((m) => m.round), 0);
  }, [activeTournament]);

  const matchesByRound = useMemo(() => {
    if (!activeTournament) return {};
    const grouped: Record<number, BracketMatch[]> = {};
    activeTournament.matches.forEach((m) => {
      if (!grouped[m.round]) grouped[m.round] = [];
      grouped[m.round].push(m);
    });
    Object.keys(grouped).forEach((k) => grouped[+k].sort((a, b) => a.bracket_position - b.bracket_position));
    return grouped;
  }, [activeTournament]);

  if (loading) {
    return (
      <View style={styles.container}>
        <SafeAreaView style={{ backgroundColor: '#12121a' }} />
        <View style={styles.center}><ActivityIndicator color='#c89b3c' size='large' /><Text style={styles.loadingText}>Loading bracket...</Text></View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <SafeAreaView style={{ backgroundColor: '#12121a' }} />
        <View style={styles.center}><Text style={styles.errorText}>{error}</Text><Pressable style={styles.retryBtn} onPress={refresh}><Text style={styles.retryBtnText}>Retry</Text></Pressable></View>
      </View>
    );
  }

  if (!activeTournament || setupMode) {
    return (
      <View style={styles.container}>
        <SafeAreaView style={{ backgroundColor: '#12121a' }} />
        <ScrollView contentContainerStyle={styles.setupContent}>
          <View style={styles.setupHeader}>
            <Text style={styles.setupTitle}>Create Bracket</Text>
            <Text style={styles.setupSubtitle}>Select available players, then shuffle to set matchups.</Text>
          </View>

          {isSpectatorView && (
            <View style={styles.spectatorBanner}>
              <Text style={styles.spectatorBannerText}>You are viewing as spectator. Only organizers can change pairings or report results.</Text>
            </View>
          )}

          <View style={styles.playerList}>
            {players.map((p) => (
              <Pressable
                key={p.player_id}
                style={[styles.playerRow, p.available && styles.playerRowAvailable]}
                onPress={() => { if (canOrganize) toggleAvailability(p.player_id); }}
                disabled={!canOrganize}
              >
                <View style={[styles.playerCheckbox, p.available && styles.playerCheckboxActive]}>
                  {p.available && <Ionicons name='checkmark' size={16} color='#0a0a0f' />}
                </View>
                <Text style={[styles.playerRowName, p.available && styles.playerRowNameActive]}>{p.player_name}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.countText}>{availableCount} players available</Text>

          <Pressable
            style={[styles.createBtn, (availableCount < 2 || !canOrganize) && styles.createBtnDisabled]}
            onPress={async () => { if (availableCount >= 2 && canOrganize) { await createBracket(); setSetupMode(false); } }}
            disabled={availableCount < 2 || !canOrganize}
          >
            <Text style={styles.createBtnText}>Create & Shuffle Bracket</Text>
          </Pressable>

          {pastTournaments.length > 0 && (
            <View style={styles.pastSection}>
              <Text style={styles.pastTitle}>Past Tournaments</Text>
              {pastTournaments.map((t) => (
                <View key={t.id} style={styles.pastRow}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={styles.pastName}>{t.title}</Text>
                    {t.tournament_seed ? (
                      <Text style={styles.pastSeed} selectable>Seed: {t.tournament_seed}</Text>
                    ) : null}
                  </View>
                  <Text style={styles.pastDate}>{new Date(t.created_at).toLocaleDateString()}</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  const roundLabels: string[] = [];
  for (let i = 1; i <= totalRounds; i++) {
    if (i === totalRounds) roundLabels.push('Finals');
    else if (i === totalRounds - 1) roundLabels.push('Semifinals');
    else if (i === totalRounds - 2) roundLabels.push('Quarterfinals');
    else roundLabels.push('Round ' + i);
  }

  return (
    <View style={styles.container}>
      <SafeAreaView style={{ backgroundColor: '#12121a' }} />
      {isSpectatorView && (
        <View style={styles.spectatorBanner}>
          <Text style={styles.spectatorBannerText}>You are viewing as spectator. Match results can only be recorded by organizers.</Text>
        </View>
      )}
      <View style={styles.bracketHeader}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name='arrow-back' size={22} color='#f0f0f8' />
        </Pressable>
        <View style={styles.bracketTitleBlock}>
          <Text style={styles.bracketTitle} numberOfLines={1}>{activeTournament.title}</Text>
          {canOrganize && activeTournament.tournament_seed ? (
            <Text style={styles.bracketSeed} selectable>Dispute seed: {activeTournament.tournament_seed}</Text>
          ) : null}
        </View>
        <Pressable
          style={[styles.shuffleBtn, !canOrganize && styles.shuffleBtnDisabled]}
          onPress={async () => {
            if (!canOrganize) return;
            const r1 = activeTournament.matches.filter((m) => m.round === 1);
            const anyComplete = r1.some((m) => m.winner_id !== null);
            if (anyComplete) { Alert.alert('Cannot Shuffle', 'Matches have already been played.'); return; }
            await shuffleBracket();
          }}
          disabled={!canOrganize}
        >
          <Ionicons name='shuffle' size={22} color={canOrganize ? '#c89b3c' : '#404058'} />
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bracketScroll}>
        <View style={styles.bracketContainer}>
          {Object.keys(matchesByRound).map((roundKey) => {
            const round = +roundKey;
            const labelIndex = round - 1;
            const label = roundLabels[labelIndex] ?? 'Round ' + round;
            return (
              <View key={round} style={styles.bracketColumn}>
                <Text style={styles.roundLabel}>{label}</Text>
                <View style={styles.matchList}>
                  {matchesByRound[round].map((m) => (
                    <MatchCard key={m.match_id} match={m} interactive={canOrganize} reportWinner={reportWinner} />
                  ))}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  loadingText: { color: '#a0a0b8', fontSize: 14, marginTop: 8 },
  errorText: { color: '#ef4444', fontSize: 15, textAlign: 'center' },
  retryBtn: { backgroundColor: '#1a1a26', borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12, borderWidth: 1, borderColor: '#333344', marginTop: 8 },
  retryBtnText: { color: '#c89b3c', fontWeight: '700', fontSize: 14 },

  setupContent: { padding: 20, paddingBottom: 40 },
  setupHeader: { marginBottom: 24 },
  setupTitle: { color: '#f0f0f8', fontSize: 28, fontWeight: '800', marginBottom: 6 },
  setupSubtitle: { color: '#606078', fontSize: 14, lineHeight: 20 },

  playerList: { gap: 8, marginBottom: 16 },
  playerRow: { flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: '#12121a', borderRadius: 10, borderWidth: 1, borderColor: '#1e1e2e', gap: 12 },
  playerRowAvailable: { borderColor: '#c89b3c', backgroundColor: '#15130a' },
  playerCheckbox: { width: 24, height: 24, borderRadius: 6, backgroundColor: '#222233', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#333344' },
  playerCheckboxActive: { backgroundColor: '#c89b3c', borderColor: '#c89b3c' },
  playerRowName: { color: '#606078', fontSize: 16, fontWeight: '600' },
  playerRowNameActive: { color: '#f0f0f8' },
  countText: { color: '#a0a0b8', fontSize: 14, marginBottom: 20, textAlign: 'center' },

  createBtn: { backgroundColor: '#c89b3c', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  createBtnText: { color: '#0a0a0f', fontSize: 16, fontWeight: '800' },
  createBtnDisabled: { backgroundColor: '#1a1a26' },

  pastSection: { marginTop: 32 },
  pastTitle: { color: '#c89b3c', fontSize: 11, fontWeight: '800', letterSpacing: 1.4, marginBottom: 12 },
  pastRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a26' },
  pastName: { color: '#a0a0b8', fontSize: 14, fontWeight: '600' },
  pastDate: { color: '#606078', fontSize: 13 },
  pastSeed: { color: '#606078', fontSize: 11, fontFamily: 'monospace', marginTop: 4 },

  spectatorBanner: { backgroundColor: '#1a1520', borderBottomWidth: 1, borderBottomColor: '#333348', paddingHorizontal: 16, paddingVertical: 10 },
  spectatorBannerText: { color: '#a0a0b8', fontSize: 13, lineHeight: 18, textAlign: 'center' },

  bracketHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16, backgroundColor: '#12121a', borderBottomWidth: 1, borderBottomColor: '#1e1e2e' },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1a1a26', alignItems: 'center', justifyContent: 'center' },
  bracketTitleBlock: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  bracketTitle: { color: '#f0f0f8', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  bracketSeed: { color: '#9090a8', fontSize: 11, fontFamily: 'monospace', marginTop: 4, textAlign: 'center' },
  shuffleBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1a1a26', alignItems: 'center', justifyContent: 'center' },
  shuffleBtnDisabled: { opacity: 0.45 },

  bracketScroll: { paddingVertical: 20, paddingHorizontal: 10 },
  bracketContainer: { flexDirection: 'row', gap: 16 },

  bracketColumn: { width: 180, gap: 0 },
  roundLabel: { color: '#c89b3c', fontSize: 11, fontWeight: '800', letterSpacing: 1.4, textAlign: 'center', marginBottom: 12, textTransform: 'uppercase' },
  matchList: { gap: 12 },

  matchCard: { backgroundColor: '#12121a', borderRadius: 8, borderWidth: 1, borderColor: '#1e1e2e', overflow: 'hidden' },
  matchSlot: { padding: 10, minHeight: 36 },
  matchSlotWinner: { backgroundColor: 'rgba(34,197,94,0.1)' },
  matchSlotEmpty: { opacity: 0.5 },
  slotInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  slotName: { color: '#a0a0b8', fontSize: 13, fontWeight: '600', flex: 1 },
  slotNameWinner: { color: '#f0f0f8', fontWeight: '800' },
  slotEmptyText: { color: '#404058', fontSize: 13, fontStyle: 'italic' },
  matchDivider: { height: 1, backgroundColor: '#1e1e2e' },
});
