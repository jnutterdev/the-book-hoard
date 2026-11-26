import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
    appMeta,
    externalIds,
    libraryEntries,
    listItems,
    syncConflicts,
    syncOutbox,
    syncSnapshots,
    type SyncedEntity,
} from "@/db/schema";
import { HardcoverError } from "@/lib/hardcover/client";
import type { HcList, HcUserBook } from "@/lib/hardcover/library";
import { deleteListBook, insertListBook, updateUserBook, type UserBookChanges } from "@/lib/hardcover/mutations";
import { log } from "@/lib/log";

/** Local field → Hardcover `user_books` field. */
export const REMOTE_FIELD = {
    status: "status_id",
    rating: "rating",
    review: "review_markdown",
    notes: "private_notes",
} as const satisfies Record<string, keyof UserBookChanges>;
export type PushableField = keyof typeof REMOTE_FIELD;

/** Long writing waits for approval before it's sent. */
export const LONG_TEXT_FIELDS = new Set<string>(["review", "notes"]);
/** Hardcover's `owned` flag isn't writable; ownership goes up as Owned list entries instead. */
const LOCAL_ONLY_FIELDS = new Set<string>(["owned"]);
/** Errors that mean "stop pushing for now" rather than "this one change is bad". */
const STOP_KINDS = new Set<HardcoverError["kind"]>(["missing_token", "unauthorized", "rate_limited", "network"]);
const MAX_ATTEMPTS = 5;

const PUSH_ENABLED_KEY = "push_enabled";

export interface PushStats {
    pushed: number;
    failed: number;
    conflicts: number;
    awaitingApproval: number;
}

export function isPushEnabled(): boolean {
    return db.select({ id: appMeta.id }).from(appMeta).where(eq(appMeta.key, PUSH_ENABLED_KEY)).get() !== undefined;
}

export function enablePush(): void {
    if (isPushEnabled()) return;
    db.insert(appMeta).values({ key: PUSH_ENABLED_KEY, value: new Date().toISOString() }).run();
}

type OutboxRow = typeof syncOutbox.$inferSelect;
type Outcome = "sent" | "waiting";

function externalIdOf(entityType: SyncedEntity, localId: string): number | null {
    const row = db
        .select({ externalId: externalIds.externalId })
        .from(externalIds)
        .where(
            and(
                eq(externalIds.source, "hardcover"),
                eq(externalIds.entityType, entityType),
                eq(externalIds.entityId, localId),
            ),
        )
        .get();
    return row ? Number(row.externalId) : null;
}

export function snapshotPayload<T>(entityType: SyncedEntity, localId: string): T | null {
    const row = db
        .select({ payload: syncSnapshots.remotePayload })
        .from(syncSnapshots)
        .where(
            and(
                eq(syncSnapshots.source, "hardcover"),
                eq(syncSnapshots.entityType, entityType),
                eq(syncSnapshots.entityId, localId),
            ),
        )
        .get();
    return row ? (row.payload as T) : null;
}

/** Puts local and remote values in the same shape so they can be compared. */
export function normalize(field: PushableField, value: unknown): string | number | null {
    if (value === null || value === undefined || value === "") return null;
    if (field === "status" || field === "rating") {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }
    return String(value);
}

export function remoteValue(payload: HcUserBook, field: PushableField): unknown {
    const key = REMOTE_FIELD[field];
    const source = payload as unknown as Record<string, unknown>;
    // The pull reads review text as `review_raw`.
    return key === "review_markdown" ? source.review_raw : source[key];
}

function markSent(rowId: string): void {
    db.update(syncOutbox).set({ status: "sent", lastError: null }).where(eq(syncOutbox.id, rowId)).run();
}

function openConflict(
    entityId: string,
    field: string,
    values: { local: unknown; remote: unknown; base: unknown },
): boolean {
    const existing = db
        .select({ id: syncConflicts.id })
        .from(syncConflicts)
        .where(
            and(
                eq(syncConflicts.entityType, "library_entry"),
                eq(syncConflicts.entityId, entityId),
                eq(syncConflicts.field, field),
                isNull(syncConflicts.resolvedAt),
                isNull(syncConflicts.deletedAt),
            ),
        )
        .get();
    if (existing) {
        // Still undecided: keep it showing the latest values on both sides.
        db.update(syncConflicts)
            .set({ localValue: values.local ?? null, remoteValue: values.remote ?? null })
            .where(eq(syncConflicts.id, existing.id))
            .run();
        return false;
    }
    db.insert(syncConflicts)
        .values({
            entityType: "library_entry",
            entityId,
            field,
            localValue: values.local ?? null,
            remoteValue: values.remote ?? null,
            baseValue: values.base ?? null,
        })
        .run();
    return true;
}

async function pushEntryUpdate(row: OutboxRow, stats: PushStats): Promise<Outcome> {
    const entry = db.select().from(libraryEntries).where(eq(libraryEntries.id, row.entityId)).get();
    if (!entry || entry.deletedAt) {
        markSent(row.id);
        return "sent";
    }

    const fields = row.changedFields.filter(
        (field): field is PushableField => !LOCAL_ONLY_FIELDS.has(field) && field in REMOTE_FIELD,
    );
    if (fields.some((field) => LONG_TEXT_FIELDS.has(field)) && !row.approvedAt) return "waiting";
    if (fields.length === 0) {
        markSent(row.id);
        return "sent";
    }

    const userBookId = externalIdOf("library_entry", entry.id);
    const payload = snapshotPayload<HcUserBook>("library_entry", entry.id);
    if (userBookId === null || payload === null) throw new Error("This book isn't linked to Hardcover yet");

    const changes: UserBookChanges = {};
    const local = entry as unknown as Record<string, unknown>;
    for (const field of fields) {
        const mine = normalize(field, local[field]);
        const theirs = normalize(field, remoteValue(payload, field));
        const hasBase = row.baseValues !== null && field in row.baseValues;
        const base = hasBase ? normalize(field, row.baseValues?.[field]) : undefined;

        if (mine === theirs) continue;
        if (hasBase && theirs === base) {
            (changes as Record<string, unknown>)[REMOTE_FIELD[field]] = mine;
            continue;
        }
        // Hardcover changed this field too (or we can't tell): let the person decide.
        if (openConflict(entry.id, field, { local: mine, remote: theirs, base: base ?? null })) stats.conflicts++;
    }

    if (Object.keys(changes).length > 0) {
        await updateUserBook(userBookId, changes);
        stats.pushed++;
    }
    markSent(row.id);
    return "sent";
}

async function pushListItem(row: OutboxRow, stats: PushStats): Promise<Outcome> {
    const item = db.select().from(listItems).where(eq(listItems.id, row.entityId)).get();
    const linkedId = externalIdOf("list_item", row.entityId);

    if (row.op === "delete") {
        if (linkedId === null) {
            markSent(row.id); // never reached Hardcover
            return "sent";
        }
        const listPayload = item ? snapshotPayload<HcList>("list", item.listId) : null;
        const stillThere = listPayload?.list_books.some((listBook) => listBook.id === linkedId) ?? true;
        if (stillThere) {
            await deleteListBook(linkedId);
            stats.pushed++;
        }
        markSent(row.id);
        return "sent";
    }

    // create
    if (!item || item.deletedAt || linkedId !== null) {
        markSent(row.id);
        return "sent";
    }
    const hcListId = externalIdOf("list", item.listId);
    const hcBookId = externalIdOf("book", item.bookId);
    if (hcListId === null || hcBookId === null) throw new Error("This list or book isn't linked to Hardcover yet");

    const listPayload = snapshotPayload<HcList>("list", item.listId);
    const alreadyThere = listPayload?.list_books.find((listBook) => listBook.book.id === hcBookId);
    let remoteId: number;
    if (alreadyThere) {
        remoteId = alreadyThere.id;
    } else {
        // Hardcover's Owned list tracks editions, so send the edition when we know it.
        const entry = db
            .select({ editionId: libraryEntries.editionId })
            .from(libraryEntries)
            .where(and(eq(libraryEntries.bookId, item.bookId), isNull(libraryEntries.deletedAt)))
            .get();
        const hcEditionId = entry?.editionId ? externalIdOf("edition", entry.editionId) : null;
        remoteId = await insertListBook({ listId: hcListId, bookId: hcBookId, editionId: hcEditionId });
        stats.pushed++;
    }

    db.transaction((tx) => {
        tx.insert(externalIds)
            .values({ source: "hardcover", entityType: "list_item", entityId: item.id, externalId: String(remoteId) })
            .run();
        tx.update(syncOutbox).set({ status: "sent", lastError: null }).where(eq(syncOutbox.id, row.id)).run();
    });
    return "sent";
}

/**
 * Sends pending outbox rows to Hardcover, oldest first. Call it right after a
 * pull, so snapshots reflect Hardcover's current state. Throws a HardcoverError
 * when pushing should stop for now (bad key, rate limit, network).
 */
export async function pushOutbox(): Promise<PushStats> {
    const stats: PushStats = { pushed: 0, failed: 0, conflicts: 0, awaitingApproval: 0 };
    const rows = db
        .select()
        .from(syncOutbox)
        .where(and(eq(syncOutbox.status, "pending"), isNull(syncOutbox.deletedAt)))
        .orderBy(asc(syncOutbox.createdAt))
        .all();

    for (const row of rows) {
        try {
            let outcome: Outcome;
            if (row.entityType === "library_entry" && row.op === "update") outcome = await pushEntryUpdate(row, stats);
            else if (row.entityType === "list_item") outcome = await pushListItem(row, stats);
            else throw new Error(`Pushing ${row.op} for ${row.entityType} isn't supported yet`);
            if (outcome === "waiting") stats.awaitingApproval++;
        } catch (error) {
            if (error instanceof HardcoverError && STOP_KINDS.has(error.kind)) throw error;
            const attempts = row.attempts + 1;
            const message = error instanceof Error ? error.message : String(error);
            db.update(syncOutbox)
                .set({ attempts, lastError: message, status: attempts >= MAX_ATTEMPTS ? "failed" : "pending" })
                .where(eq(syncOutbox.id, row.id))
                .run();
            stats.failed++;
            void log.error("Couldn't push a change to Hardcover", { outboxId: row.id, attempts }, error);
        }
    }
    return stats;
}
