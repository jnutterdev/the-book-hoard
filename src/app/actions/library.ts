"use server";

import { refresh } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { libraryEntries, lists, READING_STATUS, type ReadingStatus } from "@/db/schema";
import { setListMembership, setOwnership } from "@/lib/list-membership";
import { enqueue } from "@/lib/outbox";

export type EditResult = { ok: true } | { ok: false; error: string };

const VALID_STATUSES = new Set<number>(Object.values(READING_STATUS));

function fail(error: string): EditResult {
    return { ok: false, error };
}

function activeEntry(entryId: string) {
    return db
        .select({ id: libraryEntries.id })
        .from(libraryEntries)
        .where(and(eq(libraryEntries.id, entryId), isNull(libraryEntries.deletedAt)))
        .get();
}

function updateEntry(entryId: string, values: Partial<typeof libraryEntries.$inferInsert>, field: string): EditResult {
    if (!activeEntry(entryId)) return fail("That book isn't in your library anymore.");
    db.transaction((tx) => {
        tx.update(libraryEntries).set(values).where(eq(libraryEntries.id, entryId)).run();
        enqueue(tx, "library_entry", entryId, "update", [field]);
    });
    refresh();
    return { ok: true };
}

export async function setStatus(entryId: string, status: number): Promise<EditResult> {
    if (!VALID_STATUSES.has(status)) return fail("Unknown reading status.");
    return updateEntry(entryId, { status: status as ReadingStatus }, "status");
}

/** `null` clears the rating. Hardcover ratings are 0.5 to 5 in half steps. */
export async function setRating(entryId: string, rating: number | null): Promise<EditResult> {
    if (rating !== null && !(rating >= 0.5 && rating <= 5 && Number.isInteger(rating * 2))) {
        return fail("Ratings go from half a star to 5 stars.");
    }
    return updateEntry(entryId, { rating }, "rating");
}

/** Local only: never touches the outbox or Hardcover. */
export async function setHidden(entryId: string, hidden: boolean): Promise<EditResult> {
    if (!activeEntry(entryId)) return fail("That book isn't in your library anymore.");
    db.update(libraryEntries)
        .set({ hiddenAt: hidden ? new Date().toISOString() : null })
        .where(eq(libraryEntries.id, entryId))
        .run();
    refresh();
    return { ok: true };
}

export async function setOwned(entryId: string, owned: boolean): Promise<EditResult> {
    const entry = db
        .select({ id: libraryEntries.id, bookId: libraryEntries.bookId })
        .from(libraryEntries)
        .where(and(eq(libraryEntries.id, entryId), isNull(libraryEntries.deletedAt)))
        .get();
    if (!entry) return fail("That book isn't in your library anymore.");
    db.transaction((tx) => setOwnership(tx, entry.id, entry.bookId, owned === true));
    refresh();
    return { ok: true };
}

export async function setOnList(bookId: string, listId: string, onList: boolean): Promise<EditResult> {
    const list = db
        .select({ id: lists.id })
        .from(lists)
        .where(and(eq(lists.id, listId), isNull(lists.deletedAt)))
        .get();
    if (!list) return fail("That list doesn't exist anymore.");
    db.transaction((tx) => setListMembership(tx, bookId, listId, onList === true));
    refresh();
    return { ok: true };
}
