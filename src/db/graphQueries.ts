
import { supabase } from "@/lib/supabase";

export interface GraphNode {
  id: string;
  type: 'season' | 'player' | 'archetype' | 'card';
  label: string;
  val: number; // For node sizing (e.g., card price or win count)
  color?: string;
  metadata?: any;
}

export interface GraphLink {
  source: string;
  target: string;
  type: 'participant' | 'played' | 'found';
}

export async function getForensicGraphData() {
  // 1. Get Active Season
  const { data: activeSeason, error: seasonError } = await supabase
    .from("seasons")
    .select("*")
    .eq("is_active", true)
    .single();

  if (seasonError || !activeSeason) throw new Error("No active season found");

  // 2. Get Participants with Player info
  const { data: participants, error: partError } = await supabase
    .from("season_participants")
    .select(`
      id,
      deck_colors,
      players (
        id,
        name,
        auth_id
      )
    `)
    .eq("season_id", activeSeason.id);

  if (partError) throw partError;

  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  // Add Season Node
  nodes.push({
    id: activeSeason.id,
    type: 'season',
    label: activeSeason.title,
    val: 20,
    color: '#FFD700'
  });

  for (const part of participants as any) {
    const player = part.players;
    if (!player) continue;

    // Add Player Node
    nodes.push({
      id: player.id,
      type: 'player',
      label: player.name,
      val: 15,
      color: '#4A90E2'
    });

    links.push({
      source: activeSeason.id,
      target: player.id,
      type: 'participant'
    });

    // Add Archetype Nodes based on colors
    if (part.deck_colors && part.deck_colors.length > 0) {
      const archetypeId = `archetype-${player.id}-${part.deck_colors.join('')}`;
      nodes.push({
        id: archetypeId,
        type: 'archetype',
        label: part.deck_colors.join(''),
        val: 10,
        color: '#8B4513',
        metadata: { colors: part.deck_colors }
      });

      links.push({
        source: player.id,
        target: archetypeId,
        type: 'played'
      });

      // 3. Get High-Value Cards for this player if auth_id exists
      if (player.auth_id) {
        const { data: cards, error: cardError } = await supabase
          .from("cards")
          .select(`
            id,
            name,
            price_usd,
            rarity,
            sessions!inner(user_id)
          `)
          .eq("sessions.user_id", player.auth_id)
          .gte("price_usd", 10) // Filter for cards > $10
          .order("price_usd", { ascending: false })
          .limit(5);

        if (!cardError && cards) {
          for (const card of cards) {
            nodes.push({
              id: card.id,
              type: 'card',
              label: card.name,
              val: Math.max(5, (card.price_usd || 0) / 2),
              color: card.rarity === 'mythic' ? '#A335EE' : '#D1B000',
              metadata: { price: card.price_usd }
            });

            links.push({
              source: archetypeId,
              target: card.id,
              type: 'found'
            });
          }
        }
      }
    }
  }

  return { nodes, links };
}
