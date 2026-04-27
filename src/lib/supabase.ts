import { createClient } from "@supabase/supabase-js";
import type { AppDatabase, AppTables } from "@/types/app-database";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient<AppDatabase>(supabaseUrl, supabaseAnonKey, {
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
export const invokeFunction = async (functionName: string, body?: unknown) => {
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

/** Row types: generated schema merged in `app-database.ts` (see `npm run db:types`). */
export type DbSession = AppTables<"sessions">;
export type DbCard = AppTables<"cards">;
export type DbDeck = AppTables<"decks">;

export type { AppDatabase as Database, AppTables as Tables } from "@/types/app-database";
export type { Database as GeneratedDatabase, Tables as GeneratedTables } from "@/types/database";
