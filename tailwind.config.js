/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Base dark surfaces
        bg: {
          primary: "#0a0a0f",
          secondary: "#12121a",
          card: "#1a1a26",
          elevated: "#222233",
          overlay: "#0f0f18",
        },
        // MTG accent colors
        accent: {
          gold: "#c89b3c",
          goldLight: "#e8c060",
          blue: "#4a9eff",
          purple: "#9d4edd",
          green: "#22c55e",
          red: "#ef4444",
        },
        // Rarity colors
        rarity: {
          common: "#a0a0b0",
          uncommon: "#8ab4c4",
          rare: "#e8c060",
          mythic: "#e87a3c",
        },
        // Text
        text: {
          primary: "#f0f0f8",
          secondary: "#a0a0b8",
          muted: "#606078",
        },
        // Status
        profit: "#22c55e",
        loss: "#ef4444",
      },
    },
  },
  plugins: [],
};
