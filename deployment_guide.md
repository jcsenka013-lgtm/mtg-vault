# 🚀 MTG Vault — Deployment Guide

This guide explains how to make your changes live on **Cloudflare Pages** and ensure your **Supabase** backend is correctly synchronized.

## 1. Local Build Test
Before pushing to production, verify that the web build works locally.

```bash
# Export the project to the 'dist' directory
npm run export
```

Once this finishes, you will see a `dist/` folder. This is what Cloudflare will host.

## 2. Pushing to GitHub
Your project is likely linked to a GitHub repository. Pushing to the `main` branch will automatically trigger a build on Cloudflare Pages.

```bash
git add .
git commit -m "Update: [Describe your changes]"
git push origin main
```

## 3. Cloudflare Pages Configuration
If you haven't set up the project on Cloudflare yet:
1. Go to the [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Select **Workers & Pages** > **Create application** > **Pages** > **Connect to Git**.
3. Select your repository.
4. Use these **Build settings**:
   - **Framework preset**: `None`
   - **Build command**: `npm run export`
   - **Build output directory**: `dist`
   - **Root directory**: `/`
5. **Environment Variables**:
   Under **Settings > Variables and Secrets**, add:
   - `EXPO_PUBLIC_SUPABASE_URL`: (Your Supabase Project URL)
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`: (Your Supabase Anon Key)

## 4. Supabase & Database
If you have made changes to the database schema in `src/db/schema.ts`, you need to ensure your Supabase database reflects these changes.

- Since you are using **Drizzle with Expo SQLite** for the local app, the production Supabase (Postgres) needs to be kept in sync manually or via Supabase migrations if you are also using it for the web version.
- Ensure your **RLS (Row Level Security)** policies in Supabase allow the web app to read/write data correctly.

## 5. Troubleshooting
- **White Screen on Load**: Check the browser console (F12) for errors. This is often due to missing environment variables.
- **Images not showing**: Ensure all assets are inside the `assets/` folder and correctly referenced.
