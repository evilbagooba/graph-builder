// SQLite database for the app. Lives at $DATA_DIR/app.db (default ./data)
// and is migrated from drizzle/ on first use.

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import path from "node:path";
import * as schema from "./schema";

const ROOT = path.resolve(import.meta.dirname, "../..");

// Kept on globalThis so Vite's dev server can reload server modules without
// reopening the database each time.
const g = globalThis as { __graphBuilderDb?: BetterSQLite3Database<typeof schema> };

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (!g.__graphBuilderDb) {
    const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(ROOT, "data"));
    mkdirSync(dataDir, { recursive: true });
    const sqlite = new Database(path.join(dataDir, "app.db"));
    sqlite.pragma("journal_mode = WAL");
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: path.join(ROOT, "drizzle") });
    g.__graphBuilderDb = db;
  }
  return g.__graphBuilderDb;
}
