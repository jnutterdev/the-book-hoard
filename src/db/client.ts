import "server-only";

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export const DATABASE_PATH = process.env.DATABASE_PATH ?? "data/book-hoard.db";

type Db = BetterSQLite3Database<typeof schema>;

function open(): Db {
  const sqlite = new Database(DATABASE_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

// Reuse one connection across dev hot reloads instead of opening a new one per edit.
const globalForDb = globalThis as typeof globalThis & { bookHoardDb?: Db };

export const db: Db = globalForDb.bookHoardDb ?? open();

if (process.env.NODE_ENV !== "production") {
  globalForDb.bookHoardDb = db;
}
