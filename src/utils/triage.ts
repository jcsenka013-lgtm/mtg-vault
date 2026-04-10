import { ScannedCard } from "../types";
import { DbCard } from "../lib/supabase";

export const LGS_CREDIT_RATE = 0.72;
export const LGS_PRICE_THRESHOLD = 2.0;

export function determineDestination(priceUsd: number | null, priceUsdFoil: number | null, isFoil: boolean): "LGS" | "BULK" {
  const price = isFoil ? (priceUsdFoil ?? priceUsd ?? 0) : (priceUsd ?? 0);
  if (price >= LGS_PRICE_THRESHOLD) {
    return "LGS";
  }
  return "BULK";
}

export function calculateLgsCredit(priceUsd: number | null, priceUsdFoil: number | null, isFoil: boolean, quantity: number = 1): number {
  const price = isFoil ? (priceUsdFoil ?? priceUsd ?? 0) : (priceUsd ?? 0);
  return price * LGS_CREDIT_RATE * quantity;
}

export function calculateRetailValue(priceUsd: number | null, priceUsdFoil: number | null, isFoil: boolean, quantity: number = 1): number {
  const price = isFoil ? (priceUsdFoil ?? priceUsd ?? 0) : (priceUsd ?? 0);
  return price * quantity;
}
