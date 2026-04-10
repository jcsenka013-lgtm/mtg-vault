import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  player_id: string;
  player_name: string;
  deck_colors: string[];
  wins: number;
  losses: number;
}

export interface SeasonParticipant {
  participant_id: string;
  player_id: string;
  player_name: string;
  deck_colors: string[];
}

export interface ActiveSeason {
  id: string;
  title: string;
}

export interface UseLeaderboardResult {
  leaderboard: LeaderboardEntry[];
  activeSeason: ActiveSeason | null;
  participants: SeasonParticipant[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  startNewSeason: (newTitle: string) => Promise<void>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useLeaderboard(): UseLeaderboardResult {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [activeSeason, setActiveSeason] = useState<ActiveSeason | null>(null);
  const [participants, setParticipants] = useState<SeasonParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch the active season
      const { data: season, error: sErr } = await supabase
        .from("seasons")
        .select("id, title")
        .eq("is_active", true)
        .single();
      if (sErr) throw sErr;
      setActiveSeason(season);

      // 2. Fetch the ranked leaderboard via the Postgres RPC function
      const { data: lb, error: lbErr } = await supabase.rpc("get_active_leaderboard");
      if (lbErr) throw lbErr;
      setLeaderboard((lb ?? []) as LeaderboardEntry[]);

      // 3. Fetch season participants for the Report Match modal
      //    The `players(name)` join resolves via the player_id FK automatically.
      const { data: parts, error: pErr } = await supabase
        .from("season_participants")
        .select("id, player_id, deck_colors, players(name)")
        .eq("season_id", season.id);
      if (pErr) throw pErr;

      setParticipants(
        (parts ?? []).map((p: any) => ({
          participant_id: p.id,
          player_id: p.player_id,
          player_name: p.players.name as string,
          deck_colors: (p.deck_colors ?? []) as string[],
        }))
      );
    } catch (err: any) {
      setError(err.message ?? "Failed to load leaderboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  const startNewSeason = useCallback(async (newTitle: string) => {
    try {
      const { error: deactivateErr } = await supabase
        .from("seasons")
        .update({ is_active: false })
        .eq("is_active", true);
      if (deactivateErr) throw deactivateErr;

      const { data: newSeason, error: insertErr } = await supabase
        .from("seasons")
        .insert({ title: newTitle, is_active: true })
        .select()
        .single();
      if (insertErr) throw insertErr;

      const { data: allPlayers, error: playersErr } = await supabase
        .from("players")
        .select("id");
      if (playersErr) throw playersErr;

      if (allPlayers && allPlayers.length > 0) {
        const pData = allPlayers.map((p: any) => ({
          season_id: newSeason.id,
          player_id: p.id,
        }));
        const { error: spErr } = await supabase
          .from("season_participants")
          .insert(pData);
        if (spErr) throw spErr;
      }

      await refresh();
    } catch (err: any) {
      throw new Error(err.message ?? "Failed to start new season.");
    }
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { leaderboard, activeSeason, participants, loading, error, refresh, startNewSeason };
}
