import { openDatabaseSync, SQLiteDatabase } from "expo-sqlite";
import { drizzle } from "drizzle-orm/expo-sqlite";
import * as schema from "./schema";

let _db: SQLiteDatabase | null = null;

export function getDb() {
  if (!_db) {
    _db = openDatabaseSync("mtg_scanner.db");
  }
  return drizzle(_db, { schema });
}

export type DrizzleDB = ReturnType<typeof getDb>;

/** Run schema migrations (create tables if not exist) */
export async function runMigrations() {
  const rawDb = openDatabaseSync("mtg_scanner.db");

  rawDb.execSync(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      set_code TEXT,
      cost_paid REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      scryfall_id TEXT NOT NULL,
      name TEXT NOT NULL,
      set_code TEXT NOT NULL,
      set_name TEXT NOT NULL,
      collector_number TEXT NOT NULL,
      rarity TEXT NOT NULL,
      colors TEXT NOT NULL DEFAULT '[]',
      is_foil INTEGER NOT NULL DEFAULT 0,
      condition TEXT NOT NULL DEFAULT 'NM',
      quantity INTEGER NOT NULL DEFAULT 1,
      price_usd REAL,
      price_usd_foil REAL,
      price_fetched_at INTEGER,
      image_uri TEXT,
      scryfall_uri TEXT,
      added_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cards_session ON cards(session_id);
    CREATE INDEX IF NOT EXISTS idx_cards_rarity ON cards(rarity);
    CREATE INDEX IF NOT EXISTS idx_cards_set ON cards(set_code);
    CREATE INDEX IF NOT EXISTS idx_cards_foil ON cards(is_foil);
  `);
}
