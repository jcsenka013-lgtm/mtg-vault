import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { DbCard } from "@/lib/supabase";

const CSV_HEADERS = [
  "Name", "Set", "Collector #", "Rarity", "Foil",
  "Condition", "Qty", "Price USD", "Price Foil USD", "Total Value",
].join(",");

function escapeCsvField(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function cardToCsvRow(card: DbCard): string {
  const price = card.is_foil ? (card.price_usd_foil ?? card.price_usd) : card.price_usd;
  const totalValue = price ? Number(price) * card.quantity : null;
  return [
    escapeCsvField(card.name),
    escapeCsvField(card.set_code.toUpperCase()),
    escapeCsvField(card.collector_number),
    escapeCsvField(card.rarity),
    escapeCsvField(card.is_foil ? "Yes" : "No"),
    escapeCsvField(card.condition),
    escapeCsvField(card.quantity),
    escapeCsvField(card.price_usd !== null ? Number(card.price_usd).toFixed(2) : ""),
    escapeCsvField(card.price_usd_foil !== null ? Number(card.price_usd_foil).toFixed(2) : ""),
    escapeCsvField(totalValue !== null ? totalValue.toFixed(2) : ""),
  ].join(",");
}

export async function exportCardsAsCsv(
  cards: DbCard[],
  filename = "mtg-export.csv"
): Promise<void> {
  const rows = [CSV_HEADERS, ...cards.map(cardToCsvRow)];
  const csvContent = rows.join("\n");

  const outFile = new File(Paths.cache, filename);
  outFile.write(csvContent);
  const fileUri = outFile.uri;

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(fileUri, {
      mimeType: "text/csv",
      dialogTitle: "Export MTG Card List",
      UTI: "public.comma-separated-values-text",
    });
  }
}

export function formatAsTcgPlayerList(cards: DbCard[]): string {
  return cards
    .map((c) => {
      const foilTag = c.is_foil ? " [FOIL]" : "";
      return `${c.quantity}x ${c.name}${foilTag} (${c.set_code.toUpperCase()}) [${c.condition}]`;
    })
    .join("\n");
}
