import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { cryptoShuffle } from "@/utils/shuffle";
import type { TablesInsert } from "@/types/database";

export interface RRPlayer {
  player_id: string;
  player_name: string;
  available: boolean;
}

export interface RRMatch {
  match_id: string;
  player1_id: string | null;
  player2_id: string | null;
  player1_name: string | null;
  player2_name: string | null;
  winner_id: string | null;
  round_number: number;
  played_at: string | null;
}

export interface RRStanding {
  player_id: string;
  player_name: string;
  matches_played: number;
  wins: number;
  losses: number;
  points: number;
}

export interface RRTournamentData {
  tournament_id: string;
  title: string;
  is_active: boolean;
  matches: RRMatch[];
}

export interface PastRRTournament {
  id: string;
  title: string;
  created_at: string;
}

type RRMatchJoined = {
  id: string;
  player1_id: string | null;
  player2_id: string | null;
  winner_id: string | null;
  round_number: number;
  played_at: string | null;
  player1?: { name?: string } | null;
  player2?: { name?: string } | null;
};

function computeStandings(matches: RRMatch[]): RRStanding[] {
  const stats: Record<string, { player_id: string; player_name: string; matches_played: number; wins: number; losses: number; points: number }> = {};

  matches.forEach((m) => {
    if (m.player1_id) {
      if (!stats[m.player1_id]) stats[m.player1_id] = { player_id: m.player1_id, player_name: m.player1_name ?? "Unknown", matches_played: 0, wins: 0, losses: 0, points: 0 };
      if (m.player2_id) stats[m.player1_id].matches_played++;
      if (m.winner_id === m.player1_id) { stats[m.player1_id].wins++; stats[m.player1_id].points += 3; }
      else if (m.winner_id && m.winner_id !== m.player1_id) { stats[m.player1_id].losses++; }
    }
    if (m.player2_id) {
      if (!stats[m.player2_id]) stats[m.player2_id] = { player_id: m.player2_id, player_name: m.player2_name ?? "Unknown", matches_played: 0, wins: 0, losses: 0, points: 0 };
      if (m.player1_id) stats[m.player2_id].matches_played++;
      if (m.winner_id === m.player2_id) { stats[m.player2_id].wins++; stats[m.player2_id].points += 3; }
      else if (m.winner_id && m.winner_id !== m.player2_id) { stats[m.player2_id].losses++; }
    }
  });

  return Object.values(stats).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return a.player_name.localeCompare(b.player_name);
  });
}

export function useRoundRobin() {
  const [players, setPlayers] = useState<RRPlayer[]>([]);
  const [activeTournament, setActiveTournament] = useState<RRTournamentData | null>(null);
  const [standings, setStandings] = useState<RRStanding[]>([]);
  const [pastTournaments, setPastTournaments] = useState<PastRRTournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: allPlayers, error: pErr } = await supabase.from("players").select("id, name").order("name");
      if (pErr) throw pErr;
      setPlayers(
        (allPlayers ?? []).map((p) => ({ player_id: p.id, player_name: p.name, available: true }))
      );

      const { data: activeTour, error: tErr } = await supabase.from("round_robin_tournaments").select("id, title, is_active").eq("is_active", true).order("created_at", { ascending: false }).maybeSingle();
      if (tErr) throw tErr;

      if (activeTour) {
        const { data: tourMatches, error: mErr } = await supabase
          .from("round_robin_matches")
          .select("id, player1_id, player2_id, winner_id, round_number, played_at, player1:player1_id(name), player2:player2_id(name)")
          .eq("tournament_id", activeTour.id)
          .order("round_number", { ascending: true })
          .order("player1_id", { ascending: true });
        if (mErr) throw mErr;
        const matches = (tourMatches ?? []).map((m) => {
          const row = m as RRMatchJoined;
          return {
            match_id: row.id,
            player1_id: row.player1_id,
            player2_id: row.player2_id,
            player1_name: row.player1?.name ?? null,
            player2_name: row.player2?.name ?? null,
            winner_id: row.winner_id,
            round_number: row.round_number,
            played_at: row.played_at,
          };
        });
        setActiveTournament({ tournament_id: activeTour.id, title: activeTour.title, is_active: activeTour.is_active, matches });
        setStandings(computeStandings(matches));
      } else {
        setActiveTournament(null);
        setStandings([]);
      }

      const { data: pastTours, error: pastErr } = await supabase.from("round_robin_tournaments").select("id, title, created_at").eq("is_active", false).order("created_at", { ascending: false }).limit(10);
      if (pastErr) throw pastErr;
      setPastTournaments((pastTours ?? []) as PastRRTournament[]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load round-robin data.");
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleAvailability = useCallback((playerId: string) => {
    setPlayers((prev) => prev.map((p) => (p.player_id === playerId ? { ...p, available: !p.available } : p)));
  }, []);

  const createRoundRobin = useCallback(async () => {
    const availablePlayers = players.filter((p) => p.available);
    if (availablePlayers.length < 2) { setError("Need at least 2 players."); return; }

    const n = availablePlayers.length;
    const totalRounds = n - 1;
    const matchesPerRound = Math.floor(n / 2);

    try {
      const { data: tournament, error: tErr } = await supabase
        .from("round_robin_tournaments")
        .insert({ title: "Round Robin " + new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }), is_active: true })
        .select()
        .single();
      if (tErr) throw tErr;

      const shuffled = cryptoShuffle(availablePlayers);
      const allMatches: TablesInsert<"round_robin_matches">[] = [];

      if (n % 2 === 0) {
        const playerIds = shuffled.map((p) => p.player_id);
        for (let round = 0; round < totalRounds; round++) {
          for (let i = 0; i < matchesPerRound; i++) {
            const p1 = playerIds[i];
            const p2 = playerIds[n - 1 - i];
            allMatches.push({ tournament_id: tournament.id, player1_id: p1, player2_id: p2, round_number: round + 1 });
          }
          const last = playerIds.pop()!;
          playerIds.splice(1, 0, last);
        }
      } else {
        const playerIds = [...shuffled.map((p) => p.player_id), null];
        const adjustedN = n + 1;
        for (let round = 0; round < totalRounds; round++) {
          for (let i = 0; i < matchesPerRound; i++) {
            const p1 = playerIds[i];
            const p2 = playerIds[adjustedN - 1 - i];
            if (p1 && p2) {
              allMatches.push({ tournament_id: tournament.id, player1_id: p1, player2_id: p2, round_number: round + 1 });
            }
          }
          const last = playerIds.pop()!;
          playerIds.splice(1, 0, last);
        }
      }

      const { error: mErr } = await supabase.from("round_robin_matches").insert(allMatches);
      if (mErr) throw mErr;
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create round-robin.");
    }
  }, [players, refresh]);

  const reportWinner = useCallback(
    async (matchId: string, winnerId: string) => {
      try {
        const { error: updateErr } = await supabase
          .from("round_robin_matches")
          .update({ winner_id: winnerId, played_at: new Date().toISOString() })
          .eq("id", matchId);
        if (updateErr) throw updateErr;

        if (activeTournament) {
          const allMatches = activeTournament.matches;
          const allComplete = allMatches.every((m) => m.winner_id !== null);
          if (allComplete) {
            await supabase
              .from("round_robin_tournaments")
              .update({ is_active: false, completed_at: new Date().toISOString() })
              .eq("id", activeTournament.tournament_id);
          }
        }
        await refresh();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to report result.");
      }
    },
    [activeTournament, refresh]
  );

  const endTournament = useCallback(async () => {
    if (!activeTournament) return;
    try {
      await supabase
        .from("round_robin_tournaments")
        .update({ is_active: false, completed_at: new Date().toISOString() })
        .eq("id", activeTournament.tournament_id);
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to end tournament.");
    }
  }, [activeTournament, refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    players,
    activeTournament,
    standings,
    pastTournaments,
    loading,
    error,
    refresh,
    toggleAvailability,
    createRoundRobin,
    reportWinner,
    endTournament,
  };
}
