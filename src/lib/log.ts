import "server-only";

import { appendFile, mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { DAY_MS, localDate } from "@/lib/dates";

const LOG_DIR = path.join(process.cwd(), "data", "logs");
const RETENTION_DAYS = 14;
const REDACTED_KEYS = new Set(["authorization", "token", "headers", "apikey", "api_key", "hardcover_api_key"]);

type Level = "warn" | "error";
type Context = Record<string, unknown>;

const globalForLog = globalThis as typeof globalThis & { bookHoardLogPruned?: boolean };

/** Drops anything that could hold a secret before it reaches disk. */
function redact(value: unknown, depth = 0): unknown {
    if (depth > 6 || value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
    const clean: Context = {};
    for (const [key, inner] of Object.entries(value as Context)) {
        clean[key] = REDACTED_KEYS.has(key.toLowerCase()) ? "[redacted]" : redact(inner, depth + 1);
    }
    return clean;
}

function describeError(error: unknown): Context | undefined {
    if (error === undefined) return undefined;
    if (!(error instanceof Error)) return { value: String(error) };
    const extra: Context = {};
    for (const key of ["kind", "status", "graphqlErrors"] as const) {
        const inner = (error as unknown as Context)[key];
        if (inner !== undefined) extra[key] = inner;
    }
    return {
        name: error.name,
        message: error.message,
        ...extra,
        stack: error.stack,
        cause: error.cause instanceof Error ? describeError(error.cause) : undefined,
    };
}

async function pruneOldLogs(): Promise<void> {
    if (globalForLog.bookHoardLogPruned) return;
    globalForLog.bookHoardLogPruned = true;
    const cutoff = localDate(new Date(Date.now() - RETENTION_DAYS * DAY_MS));
    const files = await readdir(LOG_DIR).catch((): string[] => []);
    await Promise.all(
        files
            .filter((name) => /^\d{4}-\d{2}-\d{2}\.log$/.test(name) && name.slice(0, 10) < cutoff)
            .map((name) => unlink(path.join(LOG_DIR, name)).catch(() => undefined)),
    );
}

async function write(level: Level, message: string, context?: Context, error?: unknown): Promise<void> {
    const now = new Date();
    const entry = redact({ time: now.toISOString(), level, message, context, error: describeError(error) });
    const consoleMethod = level === "error" ? console.error : console.warn;
    consoleMethod(`[${level}] ${message}`, context ?? "", error ?? "");

    try {
        await mkdir(LOG_DIR, { recursive: true });
        await appendFile(path.join(LOG_DIR, `${localDate(now)}.log`), `${JSON.stringify(entry)}\n`);
        await pruneOldLogs();
    } catch (writeError) {
        console.error("[log] could not write log file", writeError);
    }
}

/** Appends to `data/logs/YYYY-MM-DD.log`. Never throws, so logging can't break the caller. */
export const log = {
    warn: (message: string, context?: Context, error?: unknown): Promise<void> =>
        write("warn", message, context, error),
    error: (message: string, context?: Context, error?: unknown): Promise<void> =>
        write("error", message, context, error),
};
