import "server-only";

import { and, desc, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { syncRuns, type SyncErrorDetail, type SyncKind, type SyncStats, type SyncTrigger } from "@/db/schema";
import { localDate, MINUTE_MS } from "@/lib/dates";

/** A run still open after this long is assumed to have crashed. */
export const STALE_RUN_MS = 10 * MINUTE_MS;

export class SyncBusyError extends Error {
    constructor() {
        super("A sync is already running");
        this.name = "SyncBusyError";
    }
}

export interface OpenedRun {
    runId: string;
    kind: SyncKind;
    /** Only set for incremental runs. */
    cursor: string | null;
}

/**
 * Takes the sync lock: inserts an open `sync_runs` row inside an IMMEDIATE
 * transaction, so two callers can't both see "no open run" and start.
 */
export function openRun(trigger: SyncTrigger): OpenedRun {
    return db.transaction(
        (tx) => {
            const now = new Date();
            const nowIso = now.toISOString();

            tx.update(syncRuns)
                .set({
                    finishedAt: nowIso,
                    error: "Never finished (the app stopped or crashed mid-sync)",
                    errorDetail: { kind: "abandoned", step: "running" },
                })
                .where(
                    and(
                        isNull(syncRuns.finishedAt),
                        lt(syncRuns.startedAt, new Date(now.getTime() - STALE_RUN_MS).toISOString()),
                    ),
                )
                .run();

            const open = tx.select({ id: syncRuns.id }).from(syncRuns).where(isNull(syncRuns.finishedAt)).get();
            if (open) throw new SyncBusyError();

            const succeeded = and(isNotNull(syncRuns.finishedAt), isNull(syncRuns.error));
            const lastOk = tx.select().from(syncRuns).where(succeeded).orderBy(desc(syncRuns.startedAt)).get();
            const lastFullOk = tx
                .select()
                .from(syncRuns)
                .where(and(succeeded, eq(syncRuns.kind, "full")))
                .orderBy(desc(syncRuns.startedAt))
                .get();

            const fullDoneToday =
                lastFullOk !== undefined && localDate(new Date(lastFullOk.startedAt)) === localDate(now);
            const cursor = lastOk?.cursor ?? null;
            const kind: SyncKind = fullDoneToday && cursor ? "incremental" : "full";

            const runId = crypto.randomUUID();
            tx.insert(syncRuns).values({ id: runId, source: "hardcover", kind, trigger, startedAt: nowIso }).run();
            return { runId, kind, cursor: kind === "incremental" ? cursor : null };
        },
        { behavior: "immediate" },
    );
}

export function finishRunOk(runId: string, stats: SyncStats, cursor: string | null): void {
    db.update(syncRuns)
        .set({
            finishedAt: new Date().toISOString(),
            stats,
            cursor,
            pulled: stats.booksChanged + stats.listsChanged,
        })
        .where(eq(syncRuns.id, runId))
        .run();
}

export function finishRunFailed(runId: string, message: string, detail: SyncErrorDetail, stats: SyncStats): void {
    db.update(syncRuns)
        .set({ finishedAt: new Date().toISOString(), error: message, errorDetail: detail, stats })
        .where(eq(syncRuns.id, runId))
        .run();
}
