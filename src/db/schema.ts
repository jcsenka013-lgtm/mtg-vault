import { sqliteTable, text, real, integer, index } from "drizzle-orm/sqlite-core";

// ─── Sessions (one per box opening) ────────────────────────────────────────
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  setCode: text("set_code"),
  costPaid: real("cost_paid").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// ─── Scanned Cards ──────────────────────────────────────────────────────────
export const cards = sqliteTable(
  "cards",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    scryfallId: text("scryfall_id").notNull(),
    name: text("name").notNull(),
    setCode: text("set_code").notNull(),
    setName: text("set_name").notNull(),
    collectorNumber: text("collector_number").notNull(),
    rarity: text("rarity").notNull(), // common | uncommon | rare | mythic
    colors: text("colors").notNull().default("[]"), // JSON array, e.g. '["W","U"]'
    isFoil: integer("is_foil", { mode: "boolean" }).notNull().default(false),
    condition: text("condition").notNull().default("NM"), // NM | LP | MP | HP | DMG
    quantity: integer("quantity").notNull().default(1),
    priceUsd: real("price_usd"),
    priceUsdFoil: real("price_usd_foil"),
    priceFetchedAt: integer("price_fetched_at"),
    imageUri: text("image_uri"),
    scryfallUri: text("scryfall_uri"),
    addedAt: integer("added_at").notNull(),
  },
  (table) => [
    index("idx_cards_session").on(table.sessionId),
    index("idx_cards_rarity").on(table.rarity),
    index("idx_cards_set").on(table.setCode),
    index("idx_cards_foil").on(table.isFoil),
  ]
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Card = typeof cards.$inferSelect;
export type NewCard = typeof cards.$inferInsert;
