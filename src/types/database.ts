export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      cards: {
        Row: {
          added_at: string
          collector_number: string
          colors: Json
          condition: string
          id: string
          image_uri: string | null
          is_foil: boolean
          language: string | null
          name: string
          price_fetched_at: string | null
          price_usd: number | null
          price_usd_foil: number | null
          quantity: number
          rarity: string
          scan_confidence: number | null
          scan_image_match_rank: number | null
          scan_ocr_engine: string | null
          scan_ocr_unverified: boolean
          scryfall_id: string
          scryfall_uri: string | null
          session_id: string
          set_code: string
          set_name: string
        }
        Insert: {
          added_at?: string
          collector_number: string
          colors?: Json
          condition?: string
          language?: string | null
          id?: string
          image_uri?: string | null
          is_foil?: boolean
          name: string
          price_fetched_at?: string | null
          price_usd?: number | null
          price_usd_foil?: number | null
          quantity?: number
          rarity: string
          scan_confidence?: number | null
          scan_image_match_rank?: number | null
          scan_ocr_engine?: string | null
          scan_ocr_unverified?: boolean
          scryfall_id: string
          scryfall_uri?: string | null
          session_id: string
          set_code: string
          set_name: string
        }
        Update: {
          added_at?: string
          collector_number?: string
          colors?: Json
          condition?: string
          id?: string
          image_uri?: string | null
          is_foil?: boolean
          language?: string | null
          name?: string
          price_fetched_at?: string | null
          price_usd?: number | null
          price_usd_foil?: number | null
          quantity?: number
          rarity?: string
          scan_confidence?: number | null
          scan_image_match_rank?: number | null
          scan_ocr_engine?: string | null
          scan_ocr_unverified?: boolean
          scryfall_id?: string
          scryfall_uri?: string | null
          session_id?: string
          set_code?: string
          set_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "cards_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_submissions: {
        Row: {
          created_at: string
          email: string
          id: string
          message: string
          name: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          message: string
          name: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          message?: string
          name?: string
        }
        Relationships: []
      }
      deck_cards: {
        Row: {
          card_id: string
          created_at: string | null
          deck_id: string
          id: string
          image_uri: string | null
          mana_cost: string | null
          name: string | null
          quantity: number | null
          rarity: string | null
          type_line: string | null
          updated_at: string | null
          zone: string | null
        }
        Insert: {
          card_id: string
          created_at?: string | null
          deck_id: string
          id?: string
          image_uri?: string | null
          mana_cost?: string | null
          name?: string | null
          quantity?: number | null
          rarity?: string | null
          type_line?: string | null
          updated_at?: string | null
          zone?: string | null
        }
        Update: {
          card_id?: string
          created_at?: string | null
          deck_id?: string
          id?: string
          image_uri?: string | null
          mana_cost?: string | null
          name?: string | null
          quantity?: number | null
          rarity?: string | null
          type_line?: string | null
          updated_at?: string | null
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deck_cards_deck_id_fkey"
            columns: ["deck_id"]
            isOneToOne: false
            referencedRelation: "decks"
            referencedColumns: ["id"]
          },
        ]
      }
      decks: {
        Row: {
          card_count: number | null
          created_at: string | null
          event_date: string | null
          format: string | null
          id: string
          name: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          card_count?: number | null
          created_at?: string | null
          event_date?: string | null
          format?: string | null
          id?: string
          name: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          card_count?: number | null
          created_at?: string | null
          event_date?: string | null
          format?: string | null
          id?: string
          name?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      matches: {
        Row: {
          created_at: string
          id: string
          loser_id: string
          season_id: string
          winner_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          loser_id: string
          season_id: string
          winner_id: string
        }
        Update: {
          created_at?: string
          id?: string
          loser_id?: string
          season_id?: string
          winner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "matches_loser_id_fkey"
            columns: ["loser_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          auth_id: string | null
          created_at: string
          id: string
          name: string
        }
        Insert: {
          auth_id?: string | null
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          auth_id?: string | null
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      round_robin_matches: {
        Row: {
          created_at: string
          id: string
          played_at: string | null
          player1_id: string | null
          player2_id: string | null
          round_number: number
          tournament_id: string
          winner_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          played_at?: string | null
          player1_id?: string | null
          player2_id?: string | null
          round_number?: number
          tournament_id: string
          winner_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          played_at?: string | null
          player1_id?: string | null
          player2_id?: string | null
          round_number?: number
          tournament_id?: string
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "round_robin_matches_player1_id_fkey"
            columns: ["player1_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "round_robin_matches_player2_id_fkey"
            columns: ["player2_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "round_robin_matches_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "round_robin_tournaments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "round_robin_matches_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      round_robin_tournaments: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          is_active: boolean
          started_at: string
          title: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          started_at?: string
          title: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          started_at?: string
          title?: string
        }
        Relationships: []
      }
      season_participants: {
        Row: {
          created_at: string
          deck_colors: string[]
          id: string
          player_id: string
          season_id: string
        }
        Insert: {
          created_at?: string
          deck_colors?: string[]
          id?: string
          player_id: string
          season_id: string
        }
        Update: {
          created_at?: string
          deck_colors?: string[]
          id?: string
          player_id?: string
          season_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "season_participants_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_participants_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      seasons: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          title?: string
        }
        Relationships: []
      }
      sessions: {
        Row: {
          cost_paid: number
          created_at: string
          id: string
          name: string
          set_code: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          cost_paid?: number
          created_at?: string
          id?: string
          name: string
          set_code?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          cost_paid?: number
          created_at?: string
          id?: string
          name?: string
          set_code?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      tournament_matches: {
        Row: {
          bracket_position: number
          created_at: string
          id: string
          player1_id: string | null
          player2_id: string | null
          round: number
          tournament_id: string
          winner_id: string | null
        }
        Insert: {
          bracket_position: number
          created_at?: string
          id?: string
          player1_id?: string | null
          player2_id?: string | null
          round: number
          tournament_id: string
          winner_id?: string | null
        }
        Update: {
          bracket_position?: number
          created_at?: string
          id?: string
          player1_id?: string | null
          player2_id?: string | null
          round?: number
          tournament_id?: string
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tournament_matches_player1_id_fkey"
            columns: ["player1_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_matches_player2_id_fkey"
            columns: ["player2_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_matches_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_matches_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      tournaments: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          is_active: boolean
          started_at: string
          title: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          started_at?: string
          title: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          started_at?: string
          title?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_active_leaderboard: {
        Args: never
        Returns: {
          deck_colors: string[]
          losses: number
          player_id: string
          player_name: string
          wins: number
        }[]
      }
      get_auth_user_id: { Args: never; Returns: string }
      get_lifetime_leaderboard: {
        Args: never
        Returns: {
          lifetime_losses: number
          lifetime_wins: number
          player_id: string
          player_name: string
          win_percentage: number
        }[]
      }
      get_player_profile: {
        Args: { p_id: string }
        Returns: {
          favorite_colors: string[]
          lifetime_losses: number
          lifetime_wins: number
          nemesis_losses: number
          nemesis_name: string
          player_id: string
          player_name: string
          rivalry_matrix: Json
          victim_name: string
          victim_wins: number
          win_percentage: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
