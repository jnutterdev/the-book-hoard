import "server-only";

import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { DATABASE_PATH } from "@/lib/paths";
import * as schema from "./schema";

type Db = BetterSQLite3Database<typeof schema>;

function open(): Db {
  mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });
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
