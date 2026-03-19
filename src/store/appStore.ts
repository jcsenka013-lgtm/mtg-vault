import { create } from "zustand";
import type { ScannedCard } from "@mtgtypes/index";
import { ManaTheme } from "@/theme";

interface ScanSession {
  id: string;
  name: string;
  costPaid: number;
}

interface AppStore {
  // Theme state
  activeTheme: ManaTheme;
  setTheme: (theme: ManaTheme) => void;

  // Active session
  activeSession: ScanSession | null;
  setActiveSession: (session: ScanSession | null) => void;
  updateSessionCost: (cost: number) => void;

  // Scanning state
  pendingCard: ScannedCard | null;
  setPendingCard: (card: ScannedCard | null) => void;

  // Scanner UI state
  isScannerActive: boolean;
  setScannerActive: (active: boolean) => void;
  scannerLocked: boolean;
  setScannerLocked: (locked: boolean) => void;

  // Inventory filters
  rarityFilter: string;
  setRarityFilter: (rarity: string) => void;
  foilFilter: string;
  setFoilFilter: (foil: string) => void;
  sortField: string;
  setSortField: (field: string) => void;
  sortOrder: "asc" | "desc";
  setSortOrder: (order: "asc" | "desc") => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  activeTheme: "C",
  setTheme: (theme) => set({ activeTheme: theme }),

  activeSession: null,
  setActiveSession: (session) => set({ activeSession: session }),
  updateSessionCost: (cost) =>
    set((state) =>
      state.activeSession ? { activeSession: { ...state.activeSession, costPaid: cost } } : {}
    ),

  pendingCard: null,
  setPendingCard: (card) => set({ pendingCard: card }),

  isScannerActive: false,
  setScannerActive: (active) => set({ isScannerActive: active }),
  scannerLocked: false,
  setScannerLocked: (locked) => set({ scannerLocked: locked }),

  rarityFilter: "all",
  setRarityFilter: (rarity) => set({ rarityFilter: rarity }),
  foilFilter: "all",
  setFoilFilter: (foil) => set({ foilFilter: foil }),
  sortField: "added_at",
  setSortField: (field) => set({ sortField: field }),
  sortOrder: "desc",
  setSortOrder: (order) => set({ sortOrder: order }),
  searchQuery: "",
  setSearchQuery: (query) => set({ searchQuery: query }),
}));
