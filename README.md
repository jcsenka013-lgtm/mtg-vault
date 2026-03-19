# ✦ The Vault — MTG Collection & ROI Tracker

A premium, mobile-first application designed for Magic: The Gathering collectors to scan, catalog, and track the ROI of booster openings.

## ✨ Features

- **👁 Scry Glass**: Rapid card scanning with OCR integration.
- **📚 Library**: A beautiful inventory management system with real-time Scryfall price syncing.
- **📊 ROI Dashboard**: Track the value of your booster box openings vs. their cost.
- **✏️ Manual Entry**: A fully custom manual card entry system with live preview.
- **⚡ Export**: Share your collection as a CSV for TCGplayer or direct sales.
- **🌍 Web & Mobile**: Built with Expo and deployed to Cloudflare Pages.

## 🛠 Tech Stack

- **Framework**: Expo (React Native)
- **Database**: Supabase (Postgres with RLS)
- **Styling**: NativeWind (Tailwind CSS)
- **APIs**: Scryfall & TCGplayer
- **Hosting**: Cloudflare Pages

## 🚀 Getting Started

1.  **Clone the Repo**:
    ```bash
    git clone https://github.com/[your-username]/[repo-name].git
    cd [repo-name]
    ```
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Set up Environment Variables**:
    Create a `.env.local` file with:
    ```env
    EXPO_PUBLIC_SUPABASE_URL=your-supabase-url
    EXPO_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
    ```
4.  **Run Locally**:
    ```bash
    npx expo start --web
    ```

## 🌍 Live Deployment

This project is configured for **Cloudflare Pages**.
- **Build Command**: `npm run export`
- **Output Directory**: `dist/`
- **Node.js Version**: 20

For a step-by-step guide on making your changes live, see the [Deployment Guide](deployment_guide.md).

---
*Built with Magic in mind.*
