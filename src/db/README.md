# Data access (`src/db`)

All runtime reads and writes here go through **Supabase** (`@/lib/supabase`, typed with `AppDatabase`).

- **`queries.ts`** — sessions, cards, wishlist, and related helpers used by scanner, inventory, and wishlist screens.
- **`graphQueries.ts`** — season / participant graph for the knowledge-graph visualizer.

There is **no on-device SQL cache** in this app: an earlier Drizzle + `expo-sqlite` experiment was removed. Postgres (via Supabase) is the source of truth.

Regenerate API types after schema changes:

```bash
npm run db:types
```

If the hosted project is behind local migrations, extend `src/types/app-database.ts` until introspection catches up.
