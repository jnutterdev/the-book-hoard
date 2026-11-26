import { homedir } from "node:os";
import path from "node:path";

/**
 * App data lives outside the repo. Inside it, the Next dev server's file
 * handling drops SQLite's locks, and any other process that opens the database
 * (sqlite3, drizzle-kit) can then delete the WAL out from under the app.
 */
const xdgDataHome = process.env.XDG_DATA_HOME || path.join(homedir(), ".local", "share");

export const DATA_DIR = process.env.BOOK_HOARD_DATA_DIR || path.join(xdgDataHome, "the-book-hoard");
export const DATABASE_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, "book-hoard.db");
export const LOG_DIR = path.join(DATA_DIR, "logs");
