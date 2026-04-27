import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  fisherYatesShuffle,
  randomTournamentSeedBigInt,
  seededRandom,
  tournamentSeedToMulberry32,
} from "@/utils/shuffle";

export interface TournamentPlayer {
  player_id: string;
  player_name: string;
  available: boolean;
}

export interface BracketMatch {
  match_id: string;
  round: number;
  bracket_position: number;
  player1_id: string | null;
  player2_id: string | null;
  player1_name: string | null;
  player2_name: string | null;
  winner_id: string | null;
}

export type TournamentVisibility = "public" | "league" | "private";

export interface TournamentData {
  tournament_id: string;
  title: string;
  is_active: boolean;
  matches: BracketMatch[];
  tournament_seed: string | null;
  visibility: TournamentVisibility;
  created_by: string;
  league_id: string | null;
}

export interface PastTournamentSummary {
  id: string;
  title: string;
  created_at: string;
  tournament_seed: string | null;
}

function formatTournamentSeed(seed: unknown): string | null {
  if (seed === null || seed === undefined) return null;
  if (typeof seed === "bigint") return seed.toString();
  if (typeof seed === "number") return String(seed);
  return String(seed);
}

export function useTournament() {
  const [players, setPlayers] = useState<TournamentPlayer[]>([]);
  const [activeTournament, setActiveTournament] = useState<TournamentData | null>(null);
  const [pastTournaments, setPastTournaments] = useState<PastTournamentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canOrganize, setCanOrganize] = useState(false);
  const [isSpectatorView, setIsSpectatorView] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: allPlayers, error: pErr } = await supabase.from("players").select("id, name").order("name");
      if (pErr) throw pErr;
      setPlayers(
        (allPlayers ?? []).map((p) => ({
          player_id: p.id as string,
          player_name: p.name as string,
          available: true,
        }))
      );

      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data: activeTour, error: tErr } = await supabase
        .from("tournaments")
        .select("id, title, is_active, created_by, visibility, league_id, tournament_seed")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .maybeSingle();
      if (tErr) throw tErr;

      let nextCanOrganize = false;
      if (activeTour && user) {
        nextCanOrganize = activeTour.created_by === user.id;
        if (!nextCanOrganize) {
          const { data: co } = await supabase
            .from("tournament_organizers")
            .select("user_id")
            .eq("tournament_id", activeTour.id)
            .eq("user_id", user.id)
            .maybeSingle();
          nextCanOrganize = !!co;
        }
        if (!nextCanOrganize && activeTour.league_id) {
          const { data: lm } = await supabase
            .from("league_members")
            .select("role")
            .eq("league_id", activeTour.league_id)
            .eq("user_id", user.id)
            .maybeSingle();
          nextCanOrganize = lm?.role === "organizer";
        }
      }
      setCanOrganize(nextCanOrganize);
      setIsSpectatorView(!!activeTour && !nextCanOrganize);

      if (activeTour) {
        const { data: tourMatches, error: mErr } = await supabase
          .from("tournament_matches")
          .select(
            "id, round, bracket_position, player1_id, player2_id, winner_id, player1:player1_id(name), player2:player2_id(name)"
          )
          .eq("tournament_id", activeTour.id)
          .order("round", { ascending: true })
          .order("bracket_position", { ascending: true });
        if (mErr) throw mErr;
        const seedStr = formatTournamentSeed(activeTour.tournament_seed);
        setActiveTournament({
          tournament_id: activeTour.id,
          title: activeTour.title,
          is_active: activeTour.is_active,
          tournament_seed: seedStr,
          visibility: (activeTour.visibility as TournamentVisibility) ?? "public",
          created_by: activeTour.created_by as string,
          league_id: (activeTour.league_id as string | null) ?? null,
          matches: (tourMatches ?? []).map((m) => ({
            match_id: m.id as string,
            round: m.round as number,
            bracket_position: m.bracket_position as number,
            player1_id: m.player1_id as string | null,
            player2_id: m.player2_id as string | null,
            player1_name: (m as { player1?: { name?: string } }).player1?.name ?? null,
            player2_name: (m as { player2?: { name?: string } }).player2?.name ?? null,
            winner_id: m.winner_id as string | null,
          })),
        });
      } else {
        setActiveTournament(null);
      }

      const { data: pastTours, error: pastErr } = await supabase
        .from("tournaments")
        .select("id, title, created_at, tournament_seed")
        .eq("is_active", false)
        .order("created_at", { ascending: false })
        .limit(10);
      if (pastErr) throw pastErr;
      setPastTournaments(
        (pastTours ?? []).map((t) => {
          const seedStr = formatTournamentSeed((t as { tournament_seed?: unknown }).tournament_seed);
          return {
            id: t.id as string,
            title: t.title as string,
            created_at: t.created_at as string,
            tournament_seed: seedStr,
          };
        })
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load tournament data.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleAvailability = useCallback((playerId: string) => {
    setPlayers((prev) =>
      prev.map((p) => (p.player_id === playerId ? { ...p, available: !p.available } : p))
    );
  }, []);

  const createBracket = useCallback(async () => {
    const availablePlayers = players.filter((p) => p.available);
    if (availablePlayers.length < 2) {
      setError("Need at least 2 players.");
      return;
    }
    const playerCount = availablePlayers.length;
    const roundCount = Math.ceil(Math.log2(playerCount));
    const byeCount = Math.pow(2, roundCount) - playerCount;
    try {
      const seed = randomTournamentSeedBigInt();
      const rng = seededRandom(tournamentSeedToMulberry32(seed));
      const shuffled = fisherYatesShuffle(availablePlayers, rng);
      const padded: (TournamentPlayer | null)[] = [...shuffled];
      for (let i = 0; i < byeCount; i++) padded.push(null);

      const { data: tournament, error: tErr } = await supabase
        .from("tournaments")
        .insert({
          title: "Battle " + new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          is_active: true,
          tournament_seed: seed.toString(),
        })
        .select()
        .single();
      if (tErr) throw tErr;

      const matches: {
        tournament_id: string;
        round: number;
        bracket_position: number;
        player1_id: string | null;
        player2_id: string | null;
      }[] = [];
      let matchPosition = 0;
      for (let i = 0; i < padded.length; i += 2) {
        matchPosition++;
        const p1 = padded[i];
        const p2 = padded[i + 1];
        matches.push({
          tournament_id: tournament.id,
          round: 1,
          bracket_position: matchPosition,
          player1_id: p1?.player_id ?? null,
          player2_id: p2?.player_id ?? null,
        });
      }
      let nextRoundMatchCount = matches.length / 2;
      for (let round = 2; round <= roundCount; round++) {
        for (let pos = 1; pos <= nextRoundMatchCount; pos++) {
          matches.push({
            tournament_id: tournament.id,
            round,
            bracket_position: pos,
            player1_id: null,
            player2_id: null,
          });
        }
        nextRoundMatchCount = Math.ceil(nextRoundMatchCount / 2);
      }
      const { error: mErr } = await supabase.from("tournament_matches").insert(matches);
      if (mErr) throw mErr;
      await refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create bracket.";
      setError(message);
    }
  }, [players, refresh]);

  const shuffleBracket = useCallback(async () => {
    if (!activeTournament) return;
    const round1Matches = activeTournament.matches.filter((m) => m.round === 1);
    const assignedPlayers: TournamentPlayer[] = [];
    round1Matches.forEach((m) => {
      if (m.player1_id) {
        const player = players.find((p) => p.player_id === m.player1_id);
        if (player) assignedPlayers.push(player);
      }
      if (m.player2_id) {
        const player = players.find((p) => p.player_id === m.player2_id);
        if (player) assignedPlayers.push(player);
      }
    });
    try {
      const newSeed = randomTournamentSeedBigInt();
      const rng = seededRandom(tournamentSeedToMulberry32(newSeed));
      const shuffled = fisherYatesShuffle(assignedPlayers, rng);

      const { error: seedErr } = await supabase
        .from("tournaments")
        .update({ tournament_seed: newSeed.toString() })
        .eq("id", activeTournament.tournament_id);
      if (seedErr) throw seedErr;

      let playerIndex = 0;
      for (const match of round1Matches) {
        const { error } = await supabase
          .from("tournament_matches")
          .update({
            player1_id: shuffled[playerIndex]?.player_id ?? null,
            player2_id: shuffled[playerIndex + 1]?.player_id ?? null,
            winner_id: null,
          })
          .eq("id", match.match_id);
        if (error) throw error;
        playerIndex += 2;
      }
      await refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to shuffle bracket.";
      setError(message);
    }
  }, [activeTournament, players, refresh]);

  const reportWinner = useCallback(
    async (matchId: string, winnerId: string) => {
      try {
        const { data: match, error: mErr } = await supabase
          .from("tournament_matches")
          .select("round, bracket_position")
          .eq("id", matchId)
          .single();
        if (mErr) throw mErr;
        const { error: updateErr } = await supabase.from("tournament_matches").update({ winner_id: winnerId }).eq("id", matchId);
        if (updateErr) throw updateErr;
        if (activeTournament) {
          const nextRound = match.round + 1;
          const nextPosition = Math.ceil(match.bracket_position / 2);
          const isPlayer1Slot = match.bracket_position % 2 === 1;
          const nextMatch = activeTournament.matches.find((m) => m.round === nextRound && m.bracket_position === nextPosition);
          if (nextMatch) {
            const field = isPlayer1Slot ? "player1_id" : "player2_id";
            await supabase.from("tournament_matches").update({ [field]: winnerId }).eq("id", nextMatch.match_id);
          }
          const allRoundMatches = activeTournament.matches.filter((m) => m.round === match.round);
          const allComplete = allRoundMatches.every((m) => m.winner_id !== null);
          if (allComplete) {
            const finalMatches = activeTournament.matches.filter((m) => m.round === nextRound);
            if (finalMatches.length === 1 && finalMatches[0].winner_id) {
              await supabase
                .from("tournaments")
                .update({ is_active: false, completed_at: new Date().toISOString() })
                .eq("id", activeTournament.tournament_id);
            }
          }
        }
        await refresh();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to report winner.";
        setError(message);
      }
    },
    [activeTournament, refresh]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    players,
    activeTournament,
    pastTournaments,
    loading,
    error,
    canOrganize,
    isSpectatorView,
    refresh,
    toggleAvailability,
    createBracket,
    shuffleBracket,
    reportWinner,
  };
}
