import "server-only";

import { db } from "@/db/client";
import type { SyncErrorDetail, SyncKind, SyncStats, SyncTrigger } from "@/db/schema";
import { MINUTE_MS } from "@/lib/dates";
import { HardcoverError } from "@/lib/hardcover/client";
import {
    fetchLibraryPage,
    fetchListsPage,
    LIBRARY_PAGE_SIZE,
    LISTS_PAGE_SIZE,
    type HcList,
} from "@/lib/hardcover/library";
import { getMe } from "@/lib/hardcover/me";
import { log } from "@/lib/log";
import {
    activeLinked,
    activeListItemsByList,
    applyList,
    applyUserBook,
    softDeleteEntries,
    softDeleteLists,
} from "./apply";
import { finishRunFailed, finishRunOk, openRun, SyncBusyError } from "./runs";

/** Re-read this much before the cursor, in case of clock skew on Hardcover's side. */
const CURSOR_OVERLAP_MS = 5 * MINUTE_MS;

/** Removing at least this many records, and more than this share, needs a confirmation. */
const GUARD_MIN_RECORDS = 5;
const GUARD_MAX_SHARE = 0.2;

export type SyncOutcome =
    | { status: "ok"; kind: SyncKind; stats: SyncStats }
    | { status: "busy" }
    | { status: "failed"; message: string; detail: SyncErrorDetail };

class DeletionGuardError extends Error {
    constructor(readonly wouldRemove: NonNullable<SyncErrorDetail["wouldRemove"]>) {
        super("Sync paused before removing anything");
        this.name = "DeletionGuardError";
    }
}

function tooMany(removing: number, total: number): boolean {
    return removing >= GUARD_MIN_RECORDS && removing > total * GUARD_MAX_SHARE;
}

function emptyStats(): SyncStats {
    return { booksChanged: 0, booksRemoved: 0, listsChanged: 0, listsRemoved: 0 };
}

function laterOf(a: string | null, b: string | null): string | null {
    if (!a) return b;
    if (!b) return a;
    return Date.parse(a) >= Date.parse(b) ? a : b;
}

interface PullOptions {
    trigger: SyncTrigger;
    /** Set after the deletion guard stopped a run and the user said to go ahead. */
    confirmDeletions?: boolean;
}

const globalForSync = globalThis as typeof globalThis & { bookHoardSyncInFlight?: Promise<SyncOutcome> };

/** Pulls the Hardcover library and lists into SQLite. Never throws; failures come back as an outcome. */
export async function runPull(options: PullOptions): Promise<SyncOutcome> {
    // Catches a double click before the sync_runs lock row exists.
    if (globalForSync.bookHoardSyncInFlight) return { status: "busy" };
    const inFlight = pull(options);
    globalForSync.bookHoardSyncInFlight = inFlight;
    try {
        return await inFlight;
    } finally {
        globalForSync.bookHoardSyncInFlight = undefined;
    }
}

async function pull({ trigger, confirmDeletions = false }: PullOptions): Promise<SyncOutcome> {
    let run;
    try {
        run = openRun(trigger);
    } catch (error) {
        if (error instanceof SyncBusyError) return { status: "busy" };
        throw error;
    }

    const stats = emptyStats();
    let step = "checking the Hardcover account";

    try {
        const me = await getMe();

        // Library
        const since = run.cursor ? new Date(Date.parse(run.cursor) - CURSOR_OVERLAP_MS).toISOString() : null;
        const seenEntryIds = new Set<string>();
        let newestUpdate: string | null = null;

        for (let offset = 0, page = 1; ; offset += LIBRARY_PAGE_SIZE, page++) {
            step = `fetching library page ${page}`;
            const rows = await fetchLibraryPage(me.id, offset, since);

            step = `saving library page ${page}`;
            db.transaction((tx) => {
                for (const row of rows) {
                    seenEntryIds.add(String(row.id));
                    newestUpdate = laterOf(newestUpdate, row.updated_at);
                    if (applyUserBook(tx, row)) stats.booksChanged++;
                }
            });

            if (rows.length < LIBRARY_PAGE_SIZE) break;
        }

        // Lists: few enough to fetch in full every run, which also catches membership changes.
        const remoteLists: HcList[] = [];
        for (let offset = 0, page = 1; ; offset += LISTS_PAGE_SIZE, page++) {
            step = `fetching lists page ${page}`;
            const rows = await fetchListsPage(me.id, offset);
            remoteLists.push(...rows);
            if (rows.length < LISTS_PAGE_SIZE) break;
        }

        // Everything is fetched, so it's now safe to work out removals.
        step = "checking for removals";
        const localEntries = activeLinked("library_entry");
        const entriesToRemove =
            run.kind === "full"
                ? [...localEntries].filter(([externalId]) => !seenEntryIds.has(externalId)).map(([, localId]) => localId)
                : [];

        const localLists = activeLinked("list");
        const remoteListIds = new Set(remoteLists.map((list) => String(list.id)));
        const listsToRemove = [...localLists]
            .filter(([externalId]) => !remoteListIds.has(externalId))
            .map(([, localId]) => localId);

        const localItems = activeListItemsByList();
        let itemsToRemove = 0;
        let listItemGuardTripped = false;
        for (const list of remoteLists) {
            const local = localItems.get(String(list.id));
            if (!local) continue;
            const remoteItemIds = new Set(list.list_books.map((item) => String(item.id)));
            const removing = [...local].filter((id) => !remoteItemIds.has(id)).length;
            itemsToRemove += removing;
            if (tooMany(removing, local.size)) listItemGuardTripped = true;
        }

        const guardTripped =
            tooMany(entriesToRemove.length, localEntries.size) ||
            tooMany(listsToRemove.length, localLists.size) ||
            listItemGuardTripped;

        if (guardTripped && !confirmDeletions) {
            throw new DeletionGuardError({
                books: entriesToRemove.length,
                lists: listsToRemove.length,
                listItems: itemsToRemove,
            });
        }

        step = "saving lists";
        db.transaction((tx) => {
            for (const list of remoteLists) {
                const result = applyList(tx, list);
                if (result.changed) stats.listsChanged++;
            }
            softDeleteLists(tx, listsToRemove);
            softDeleteEntries(tx, entriesToRemove);
        });
        stats.listsRemoved = listsToRemove.length;
        stats.booksRemoved = entriesToRemove.length;

        if (entriesToRemove.length > 0 || listsToRemove.length > 0) {
            void log.warn("Sync removed records that disappeared from Hardcover", {
                runId: run.runId,
                books: entriesToRemove.length,
                lists: listsToRemove.length,
            });
        }

        finishRunOk(run.runId, stats, laterOf(run.cursor, newestUpdate));
        return { status: "ok", kind: run.kind, stats };
    } catch (error) {
        const { message, detail } = describeFailure(error, step);
        finishRunFailed(run.runId, message, detail, stats);
        void log.error(`Sync failed while ${step}`, { runId: run.runId, kind: run.kind, trigger }, error);
        return { status: "failed", message, detail };
    }
}

function describeFailure(error: unknown, step: string): { message: string; detail: SyncErrorDetail } {
    if (error instanceof DeletionGuardError) {
        return {
            message: error.message,
            detail: { kind: "needs_confirmation", step, wouldRemove: error.wouldRemove },
        };
    }
    if (error instanceof HardcoverError) {
        const messages: Partial<Record<HardcoverError["kind"], string>> = {
            missing_token: "No Hardcover API key. Add HARDCOVER_API_KEY to Doppler and restart the app.",
            unauthorized: "Hardcover rejected the API key. It may have expired.",
            rate_limited: error.resetsAt ? "Hardcover's daily request limit is used up." : "Hardcover is rate limiting us.",
            network: "Couldn't reach Hardcover.",
        };
        return {
            message: messages[error.kind] ?? error.message,
            detail: {
                kind: error.kind,
                step,
                status: error.status,
                graphqlErrors: error.graphqlErrors?.map((e) => ({ message: e.message, code: e.extensions?.code })),
                retryAfter: error.resetsAt,
            },
        };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { message: `Unexpected error: ${message}`, detail: { kind: "unexpected", step } };
}
