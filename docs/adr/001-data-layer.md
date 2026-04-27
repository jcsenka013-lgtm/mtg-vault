# ADR 001: Data layer — Supabase vs local SQLite

## Status

Accepted (2026-04-27)

## Context

The repo had a `src/db/` folder containing both:

1. **Drizzle + `expo-sqlite`** (`client.ts`, `schema.ts`, `drizzle/`) — local schema mirroring sessions/cards.
2. **Supabase** (`queries.ts`, `graphQueries.ts`) — real reads/writes for the same concepts.

`getDb()` / `runMigrations()` were never imported; all live paths used Supabase. The SQLite stack added weight (native module, Drizzle kit) without delivering offline or sync behavior.

## Decision

- **Remote-only:** Use Supabase Postgres as the single source of truth for app data.
- **Remove** `expo-sqlite`, `drizzle-orm`, `drizzle-kit`, `src/db/client.ts`, `src/db/schema.ts`, and the `drizzle/` migration artifacts.
- **Typing:** Commit `src/types/database.ts` from `supabase gen types` and type the client with `AppDatabase` (`src/types/app-database.ts` merges tables/RPCs that exist in repo migrations but are missing from the linked project’s introspection).
- **Automation:** Weekly GitHub Action to regenerate types and open a PR when `database.ts` drifts.

## Consequences

- Simpler dependency graph and no duplicate session/card models.
- No offline-first guarantees; future offline work would need an explicit design (cache tables, sync, conflict rules) rather than the unused SQLite stub.
- `app-database.ts` must be trimmed when the hosted schema matches migrations, to avoid duplicate definitions.

## Alternatives considered

1. **Offline cache (local + remote)** — Renamed `src/db/local` / `remote`, sync layer, and `syncStatus` context. Rejected for this iteration: no product requirement wired to the SQLite code path.
2. **Keep Drizzle for type-safe queries only** — Still implies SQLite or another driver; rejected in favor of generated Supabase types.
