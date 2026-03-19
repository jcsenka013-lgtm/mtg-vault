export type ManaTheme = "W" | "U" | "B" | "R" | "G" | "C";

export interface ThemeColors {
  primary: string;
  background: string;
  surface: string;
  border: string;
  text: string;
  textMuted: string;
}

export const themes: Record<ManaTheme, ThemeColors> = {
  W: {
    primary: "#d4c060",
    background: "#1e1c10",
    surface: "#2a271a",
    border: "#d4c060",
    text: "#f0e4a0",
    textMuted: "#a09870",
  },
  U: {
    primary: "#3a7ac0",
    background: "#0a1220",
    surface: "#112038",
    border: "#3a7ac0",
    text: "#c0d8f0",
    textMuted: "#7a98b0",
  },
  B: {
    primary: "#6a3a9a",
    background: "#120a18",
    surface: "#21142a",
    border: "#6a3a9a",
    text: "#d0a0f0",
    textMuted: "#8a6a9a",
  },
  R: {
    primary: "#c04020",
    background: "#180a08",
    surface: "#2d1310",
    border: "#c04020",
    text: "#f8c0a0",
    textMuted: "#b87050",
  },
  G: {
    primary: "#207a40",
    background: "#0a1410",
    surface: "#122a1f",
    border: "#207a40",
    text: "#80e0a0",
    textMuted: "#509070",
  },
  C: {
    primary: "#c89b3c", // Original gold accent
    background: "#0a0a0f", // Original background
    surface: "#12121a", // Original surface
    border: "#222233", // Original border
    text: "#f0f0f8", // Original text
    textMuted: "#a0a0b8", // Original muted text
  },
};
