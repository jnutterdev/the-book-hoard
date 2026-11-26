import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { appMeta, libraryEntries, listItems, lists, OWNED_LIST_SLUG } from "@/db/schema";
import { log } from "@/lib/log";
import { enqueue, type Tx } from "@/lib/outbox";

function nextPosition(tx: Tx, listId: string): string {
    const last = tx
        .select({ position: listItems.position })
        .from(listItems)
        .where(and(eq(listItems.listId, listId), isNull(listItems.deletedAt)))
        .orderBy(desc(listItems.position))
        .get();
    const next = last ? Number.parseInt(last.position, 10) + 1 : 0;
    return String(Number.isFinite(next) ? next : 0).padStart(6, "0");
}

/**
 * Adds a book to a list or removes it, queueing the change for Hardcover.
 * A re-add revives the newest old row, so it can cancel an unsent removal.
 */
export function setListMembership(tx: Tx, bookId: string, listId: string, onList: boolean): void {
    const existing = tx
        .select({ id: listItems.id, deletedAt: listItems.deletedAt })
        .from(listItems)
        .where(and(eq(listItems.listId, listId), eq(listItems.bookId, bookId)))
        .orderBy(desc(listItems.updatedAt))
        .all();
    const active = existing.find((item) => item.deletedAt === null);

    if (onList && !active) {
        const position = nextPosition(tx, listId);
        const revived = existing[0];
        if (revived) {
            tx.update(listItems).set({ deletedAt: null, position }).where(eq(listItems.id, revived.id)).run();
            enqueue(tx, "list_item", revived.id, "create");
        } else {
            const id = crypto.randomUUID();
            tx.insert(listItems).values({ id, listId, bookId, position }).run();
            enqueue(tx, "list_item", id, "create");
        }
    }

    if (!onList && active) {
        tx.update(listItems).set({ deletedAt: new Date().toISOString() }).where(eq(listItems.id, active.id)).run();
        enqueue(tx, "list_item", active.id, "delete");
    }
}

/** Local id of Hardcover's Owned list, once a sync has brought it in. */
export function ownedListId(tx: Tx | typeof db = db): string | undefined {
    return tx
        .select({ id: lists.id })
        .from(lists)
        .where(and(eq(lists.slug, OWNED_LIST_SLUG), isNull(lists.deletedAt)))
        .get()?.id;
}

/** Books on the Owned list. This is what "I own a copy" means, since it's what Hardcover shows. */
export function ownedBookIds(): Set<string> {
    const listId = ownedListId();
    if (!listId) return new Set();
    const rows = db
        .select({ bookId: listItems.bookId })
        .from(listItems)
        .where(and(eq(listItems.listId, listId), isNull(listItems.deletedAt)))
        .all();
    return new Set(rows.map((row) => row.bookId));
}

/**
 * The single "I own a copy" switch: keeps Hardcover's hidden `owned` flag and
 * the visible Owned list in step.
 */
export function setOwnership(tx: Tx, entryId: string, bookId: string, owned: boolean): void {
    tx.update(libraryEntries).set({ owned }).where(eq(libraryEntries.id, entryId)).run();
    enqueue(tx, "library_entry", entryId, "update", ["owned"]);
    const listId = ownedListId(tx);
    if (listId) setListMembership(tx, bookId, listId, owned);
}

const BACKFILL_KEY = "owned_list_backfill_done";

/**
 * One time only: books flagged as owned (mostly from imports) but missing from
 * the Owned list get queued for it. Runs after a sync, once the Owned list exists.
 * Never repeats, so removing a book from Owned on Hardcover later sticks.
 */
export function backfillOwnedList(): number {
    return db.transaction((tx) => {
        const done = tx.select({ id: appMeta.id }).from(appMeta).where(eq(appMeta.key, BACKFILL_KEY)).get();
        if (done) return 0;
        const listId = ownedListId(tx);
        if (!listId) return 0;

        const onList = new Set(
            tx
                .select({ bookId: listItems.bookId })
                .from(listItems)
                .where(and(eq(listItems.listId, listId), isNull(listItems.deletedAt)))
                .all()
                .map((row) => row.bookId),
        );
        const flagged = tx
            .select({ bookId: libraryEntries.bookId })
            .from(libraryEntries)
            .where(and(eq(libraryEntries.owned, true), isNull(libraryEntries.deletedAt)))
            .all();

        let added = 0;
        for (const { bookId } of flagged) {
            if (onList.has(bookId)) continue;
            setListMembership(tx, bookId, listId, true);
            added++;
        }

        tx.insert(appMeta).values({ key: BACKFILL_KEY, value: new Date().toISOString() }).run();
        if (added > 0) void log.warn("Queued owned books for the Owned list (one-time backfill)", { added });
        return added;
    });
}
