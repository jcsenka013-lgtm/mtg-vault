import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/**
 * Invoke a Supabase Edge Function with proper error handling.
 * Handles local development (localhost:54321) and parses eBay API errors.
 * 
 * @param functionName - Name of the edge function to invoke
 * @param body - Payload to send with the invocation
 * @returns Object with { data, error } similar to supabase.functions.invoke
 */
export const invokeFunction = async (functionName: string, body?: any) => {
  // Determine if we're in local development (running on Expo)
  const isLocal = __DEV__ && supabaseUrl.includes("localhost");
  const functionUrl = isLocal
    ? `http://localhost:54321/v1/functions/${functionName}`
    : `${supabaseUrl}/functions/${functionName}`;

  try {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token || "";

    const response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      const error = new Error(data.message || "Function invocation failed");
      error.name = "FunctionError";

      // Parse eBay-specific nested errors
      if (data.data && data.data.errors) {
        if (Array.isArray(data.data.errors)) {
          error.message = data.data.errors[0].message || error.message;
        } else if (data.data.errors.message) {
          error.message = data.data.errors.message;
        }
      } else if (data.message) {
        error.message = data.message;
      }

      throw error;
    }

    return { data };
  } catch (error) {
    // Re-throw with consistent error structure
    throw error;
  }
};

// TypeScript types matching our Supabase schema
export interface DbSession {
  id: string;
  user_id: string;
  name: string;
  set_code: string | null;
  cost_paid: number;
  created_at: string;
  updated_at: string;
}

export interface DbCard {
  id: string;
  session_id: string;
  scryfall_id: string;
  name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  rarity: "common" | "uncommon" | "rare" | "mythic";
  colors: string[];
  is_foil: boolean;
  condition: "NM" | "LP" | "MP" | "HP" | "DMG";
  quantity: number;
  price_usd: number | null;
  price_usd_foil: number | null;
  price_fetched_at: string | null;
  image_uri: string | null;
  scryfall_uri: string | null;
  added_at: string;
  destination?: "LGS" | "BULK" | null;
  cmc?: number;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
}
