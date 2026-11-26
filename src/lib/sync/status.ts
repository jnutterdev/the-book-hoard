import "server-only";

import { and, desc, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { syncRuns, type SyncErrorDetail, type SyncStats } from "@/db/schema";
import { HOUR_MS, MINUTE_MS } from "@/lib/dates";
import { STALE_RUN_MS } from "./runs";

/** Auto-sync on open when the last good sync is older than this. */
const AUTO_SYNC_AFTER_MS = HOUR_MS;
/** After a failure, auto-sync waits this long before trying again. */
const FAILURE_COOLDOWN_MS = 15 * MINUTE_MS;
/** Failures that retrying won't fix. Auto-sync stays off until a manual sync succeeds. */
const NEEDS_PERSON = new Set(["missing_token", "unauthorized", "needs_confirmation"]);

export interface SyncStatus {
    running: boolean;
    lastRun: {
        finishedAt: string | null;
        stats: SyncStats | null;
        error: string | null;
        errorDetail: SyncErrorDetail | null;
    } | null;
    lastSuccessAt: string | null;
    autoSyncDue: boolean;
}

export function getSyncStatus(now = Date.now()): SyncStatus {
    const lastRun = db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).get();
    const lastSuccess = db
        .select({ finishedAt: syncRuns.finishedAt })
        .from(syncRuns)
        .where(and(isNotNull(syncRuns.finishedAt), isNull(syncRuns.error)))
        .orderBy(desc(syncRuns.startedAt))
        .get();

    const running =
        lastRun !== undefined && lastRun.finishedAt === null && now - Date.parse(lastRun.startedAt) < STALE_RUN_MS;

    return {
        running,
        lastRun: lastRun
            ? {
                  finishedAt: lastRun.finishedAt,
                  stats: lastRun.stats,
                  error: lastRun.error,
                  errorDetail: lastRun.errorDetail,
              }
            : null,
        lastSuccessAt: lastSuccess?.finishedAt ?? null,
        autoSyncDue: isAutoSyncDue(now, running, lastRun, lastSuccess?.finishedAt ?? null),
    };
}

function isAutoSyncDue(
    now: number,
    running: boolean,
    lastRun: typeof syncRuns.$inferSelect | undefined,
    lastSuccessAt: string | null,
): boolean {
    if (running) return false;

    if (lastRun?.error) {
        const kind = lastRun.errorDetail?.kind ?? "";
        if (NEEDS_PERSON.has(kind)) return false;
        const retryAfter = lastRun.errorDetail?.retryAfter;
        if (retryAfter && Date.parse(retryAfter) > now) return false;
        const failedAt = Date.parse(lastRun.finishedAt ?? lastRun.startedAt);
        if (now - failedAt < FAILURE_COOLDOWN_MS) return false;
    }

    return lastSuccessAt === null || now - Date.parse(lastSuccessAt) > AUTO_SYNC_AFTER_MS;
}
