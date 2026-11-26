import "server-only";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
    books,
    libraryEntries,
    listItems,
    lists,
    syncConflicts,
    syncOutbox,
    type ConflictResolution,
    type ReadingStatus,
} from "@/db/schema";
import type { HcUserBook } from "@/lib/hardcover/library";
import { enqueue } from "@/lib/outbox";
import { STATUS_INFO } from "@/lib/reading-status";
import {
    isPushEnabled,
    LONG_TEXT_FIELDS,
    normalize,
    REMOTE_FIELD,
    remoteValue,
    snapshotPayload,
    type PushableField,
} from "./push";

export interface QueueItem {
    id: string;
    bookId: string | null;
    title: string;
    change: string;
    attempts: number;
    lastError: string | null;
}

export interface ConflictItem {
    id: string;
    bookId: string | null;
    title: string;
    field: string;
    mine: string;
    theirs: string;
}

export interface SyncQueue {
    pushEnabled: boolean;
    waiting: QueueItem[];
    needsApproval: QueueItem[];
    failed: QueueItem[];
    conflicts: ConflictItem[];
}

const FIELD_LABEL: Record<string, string> = {
    status: "Status",
    rating: "Rating",
    review: "Review",
    notes: "Private notes",
    owned: "I own a copy",
};

const TEXT_PREVIEW_CHARS = 80;

function isPushable(field: string): field is PushableField {
    return field in REMOTE_FIELD;
}

/** A field's value as a person would say it. */
export function describeValue(field: string, value: unknown): string {
    if (value === null || value === undefined || value === "") {
        return field === "rating" ? "No rating" : "Empty";
    }
    if (field === "status") return STATUS_INFO[Number(value) as ReadingStatus]?.label ?? `Status ${String(value)}`;
    if (field === "rating") return `${Number(value)} ★`;
    if (field === "owned") return value ? "Yes" : "No";
    const text = String(value);
    return text.length > TEXT_PREVIEW_CHARS ? `${text.slice(0, TEXT_PREVIEW_CHARS)}…` : text;
}

type OutboxRow = typeof syncOutbox.$inferSelect;
type EntryRow = typeof libraryEntries.$inferSelect;

function describeEntryChange(row: OutboxRow, entry: EntryRow | undefined): string {
    const local = (entry ?? {}) as Record<string, unknown>;
    const parts = row.changedFields.map((field) => {
        const label = FIELD_LABEL[field] ?? field;
        return `${label} → ${describeValue(field, local[field])}`;
    });
    return parts.join(", ") || "No changes";
}

export function getSyncQueue(): SyncQueue {
    const rows = db
        .select()
        .from(syncOutbox)
        .where(and(inArray(syncOutbox.status, ["pending", "failed"]), isNull(syncOutbox.deletedAt)))
        .orderBy(asc(syncOutbox.createdAt))
        .all();

    const entryIds = rows.filter((row) => row.entityType === "library_entry").map((row) => row.entityId);
    const itemIds = rows.filter((row) => row.entityType === "list_item").map((row) => row.entityId);
    const entries = new Map(
        (entryIds.length ? db.select().from(libraryEntries).where(inArray(libraryEntries.id, entryIds)).all() : []).map(
            (entry) => [entry.id, entry],
        ),
    );
    const items = new Map(
        (itemIds.length ? db.select().from(listItems).where(inArray(listItems.id, itemIds)).all() : []).map((item) => [
            item.id,
            item,
        ]),
    );

    const conflictRows = db
        .select()
        .from(syncConflicts)
        .where(and(isNull(syncConflicts.resolvedAt), isNull(syncConflicts.deletedAt)))
        .orderBy(asc(syncConflicts.createdAt))
        .all();
    const conflictEntries = conflictRows.length
        ? db
              .select()
              .from(libraryEntries)
              .where(
                  inArray(
                      libraryEntries.id,
                      conflictRows.map((conflict) => conflict.entityId),
                  ),
              )
              .all()
        : [];
    for (const entry of conflictEntries) entries.set(entry.id, entry);

    const bookIds = new Set<string>();
    for (const entry of entries.values()) bookIds.add(entry.bookId);
    for (const item of items.values()) bookIds.add(item.bookId);
    const titles = new Map(
        (bookIds.size ? db.select({ id: books.id, title: books.title }).from(books).where(inArray(books.id, [...bookIds])).all() : []).map(
            (book) => [book.id, book.title],
        ),
    );
    const listNames = new Map(db.select({ id: lists.id, name: lists.name }).from(lists).all().map((list) => [list.id, list.name]));

    const queue: SyncQueue = { pushEnabled: isPushEnabled(), waiting: [], needsApproval: [], failed: [], conflicts: [] };

    for (const row of rows) {
        // Local-only changes (like the owned flag) have nothing to send; the push just clears them.
        const localOnly =
            row.entityType === "library_entry" && row.changedFields.every((field) => !isPushable(field));
        if (localOnly && row.status === "pending") continue;

        let bookId: string | null = null;
        let change: string;
        if (row.entityType === "library_entry") {
            const entry = entries.get(row.entityId);
            bookId = entry?.bookId ?? null;
            change = describeEntryChange(row, entry);
        } else if (row.entityType === "list_item") {
            const item = items.get(row.entityId);
            bookId = item?.bookId ?? null;
            const listName = item ? (listNames.get(item.listId) ?? "a list") : "a list";
            change = row.op === "delete" ? `Remove from ${listName}` : `Add to ${listName}`;
        } else {
            change = `${row.op} ${row.entityType}`;
        }

        const queueItem: QueueItem = {
            id: row.id,
            bookId,
            title: bookId ? (titles.get(bookId) ?? "Unknown book") : "Unknown book",
            change,
            attempts: row.attempts,
            lastError: row.lastError,
        };
        if (row.status === "failed") queue.failed.push(queueItem);
        else if (row.changedFields.some((field) => LONG_TEXT_FIELDS.has(field)) && !row.approvedAt) {
            queue.needsApproval.push(queueItem);
        } else queue.waiting.push(queueItem);
    }

    for (const conflict of conflictRows) {
        const entry = entries.get(conflict.entityId);
        const bookId = entry?.bookId ?? null;
        queue.conflicts.push({
            id: conflict.id,
            bookId,
            title: bookId ? (titles.get(bookId) ?? "Unknown book") : "Unknown book",
            field: FIELD_LABEL[conflict.field] ?? conflict.field,
            mine: describeValue(conflict.field, conflict.localValue),
            theirs: describeValue(conflict.field, conflict.remoteValue),
        });
    }

    return queue;
}

export function approveOutboxRow(id: string): void {
    db.update(syncOutbox)
        .set({ approvedAt: new Date().toISOString() })
        .where(and(eq(syncOutbox.id, id), isNull(syncOutbox.deletedAt)))
        .run();
}

export function retryOutboxRow(id: string): void {
    db.update(syncOutbox)
        .set({ status: "pending", attempts: 0, lastError: null })
        .where(and(eq(syncOutbox.id, id), eq(syncOutbox.status, "failed")))
        .run();
}

/** A local column's value from Hardcover's last known copy of the field. */
function localFromRemote(field: PushableField, value: unknown): unknown {
    const normalized = normalize(field, value);
    if (field === "status") return normalized ?? undefined; // status can't be empty locally
    return normalized;
}

/**
 * Drops an unsent change and puts the record back the way Hardcover has it,
 * so the app and Hardcover agree again.
 */
export function discardOutboxRow(id: string): void {
    db.transaction((tx) => {
        const row = tx.select().from(syncOutbox).where(eq(syncOutbox.id, id)).get();
        if (!row || row.deletedAt || row.status === "sent") return;

        if (row.entityType === "library_entry") {
            const payload = snapshotPayload<HcUserBook>("library_entry", row.entityId);
            if (payload) {
                const values: Record<string, unknown> = {};
                for (const field of row.changedFields) {
                    if (!isPushable(field)) continue;
                    const value = localFromRemote(field, remoteValue(payload, field));
                    if (value !== undefined) values[field] = value;
                }
                if (Object.keys(values).length > 0) {
                    tx.update(libraryEntries).set(values).where(eq(libraryEntries.id, row.entityId)).run();
                }
            }
        }
        if (row.entityType === "list_item") {
            const deletedAt = row.op === "create" ? new Date().toISOString() : null;
            tx.update(listItems).set({ deletedAt }).where(eq(listItems.id, row.entityId)).run();
        }

        tx.update(syncOutbox).set({ deletedAt: new Date().toISOString() }).where(eq(syncOutbox.id, id)).run();
    });
}

export function resolveConflictRow(id: string, resolution: ConflictResolution): void {
    db.transaction((tx) => {
        const conflict = tx.select().from(syncConflicts).where(eq(syncConflicts.id, id)).get();
        if (!conflict || conflict.resolvedAt || conflict.deletedAt) return;
        const field = conflict.field;
        if (conflict.entityType !== "library_entry" || !isPushable(field)) return;

        if (resolution === "local") {
            // Send ours on the next sync, treating Hardcover's current value as the base.
            enqueue(tx, "library_entry", conflict.entityId, "update", [field], { [field]: conflict.remoteValue });
        } else {
            const value = localFromRemote(field, conflict.remoteValue);
            if (value !== undefined) {
                tx.update(libraryEntries)
                    .set({ [field]: value })
                    .where(eq(libraryEntries.id, conflict.entityId))
                    .run();
            }
        }

        tx.update(syncConflicts)
            .set({ resolvedAt: new Date().toISOString(), resolution })
            .where(eq(syncConflicts.id, id))
            .run();
    });
}
