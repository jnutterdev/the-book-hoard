import "server-only";

import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
    books,
    editions,
    externalIds,
    libraryEntries,
    listItems,
    lists,
    READING_STATUS,
    reads,
    syncSnapshots,
    type ReadingStatus,
    type SyncedEntity,
} from "@/db/schema";
import type { HcBook, HcEdition, HcList, HcUserBook } from "@/lib/hardcover/library";
import { pendingEntityIds, pendingFields, type Tx } from "@/lib/outbox";

const VALID_STATUSES = new Set<number>(Object.values(READING_STATUS));

function hashOf(payload: unknown): string {
    return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function findLinked(tx: Tx, entityType: SyncedEntity, externalId: number): string | undefined {
    return tx
        .select({ id: externalIds.entityId })
        .from(externalIds)
        .where(
            and(
                eq(externalIds.source, "hardcover"),
                eq(externalIds.entityType, entityType),
                eq(externalIds.externalId, String(externalId)),
            ),
        )
        .get()?.id;
}

function link(tx: Tx, entityType: SyncedEntity, entityId: string, externalId: number, url: string | null = null): void {
    tx.insert(externalIds)
        .values({ source: "hardcover", entityType, entityId, externalId: String(externalId), url })
        .run();
}

function bookUrl(book: HcBook): string | null {
    return book.slug ? `https://hardcover.app/books/${book.slug}` : null;
}

function snapshotHash(tx: Tx, entityType: SyncedEntity, entityId: string): string | undefined {
    return tx
        .select({ hash: syncSnapshots.remoteHash })
        .from(syncSnapshots)
        .where(
            and(
                eq(syncSnapshots.source, "hardcover"),
                eq(syncSnapshots.entityType, entityType),
                eq(syncSnapshots.entityId, entityId),
            ),
        )
        .get()?.hash;
}

function saveSnapshot(tx: Tx, entityType: SyncedEntity, entityId: string, payload: unknown, hash: string): void {
    const syncedAt = new Date().toISOString();
    tx.insert(syncSnapshots)
        .values({ source: "hardcover", entityType, entityId, remoteHash: hash, remotePayload: payload, syncedAt })
        .onConflictDoUpdate({
            target: [syncSnapshots.source, syncSnapshots.entityType, syncSnapshots.entityId],
            set: { remoteHash: hash, remotePayload: payload, syncedAt },
        })
        .run();
}

function authorsOf(book: HcBook): string[] {
    const contributors = book.cached_contributors ?? [];
    const named = contributors.filter((c) => c.author?.name);
    const authors = named.filter((c) => !c.contribution || c.contribution === "Author");
    return (authors.length > 0 ? authors : named).map((c) => c.author?.name ?? "");
}

export function upsertBook(tx: Tx, book: HcBook): string {
    const values = {
        title: book.title,
        subtitle: book.subtitle,
        authors: authorsOf(book),
        description: book.description,
        coverUrl: book.cached_image?.url ?? null,
        pageCount: book.pages,
        firstPublished: book.release_date,
        deletedAt: null,
    };
    const existing = findLinked(tx, "book", book.id);
    if (existing) {
        tx.update(books).set(values).where(eq(books.id, existing)).run();
        tx.update(externalIds)
            .set({ url: bookUrl(book) })
            .where(
                and(
                    eq(externalIds.source, "hardcover"),
                    eq(externalIds.entityType, "book"),
                    eq(externalIds.externalId, String(book.id)),
                ),
            )
            .run();
        return existing;
    }
    const id = crypto.randomUUID();
    tx.insert(books).values({ id, ...values }).run();
    link(tx, "book", id, book.id, bookUrl(book));
    return id;
}

export function upsertEdition(tx: Tx, bookId: string, edition: HcEdition): string {
    const values = {
        bookId,
        isbn10: edition.isbn_10,
        isbn13: edition.isbn_13,
        format: edition.edition_format ?? edition.physical_format,
        publisher: edition.publisher?.name ?? null,
        pages: edition.pages,
        deletedAt: null,
    };
    const existing = findLinked(tx, "edition", edition.id);
    if (existing) {
        tx.update(editions).set(values).where(eq(editions.id, existing)).run();
        return existing;
    }
    const id = crypto.randomUUID();
    tx.insert(editions).values({ id, ...values }).run();
    link(tx, "edition", id, edition.id);
    return id;
}

function toStatus(statusId: number | null): ReadingStatus {
    return statusId !== null && VALID_STATUSES.has(statusId) ? (statusId as ReadingStatus) : READING_STATUS.wantToRead;
}

function toRating(rating: number | string | null): number | null {
    if (rating === null) return null;
    const value = Number(rating);
    return Number.isFinite(value) ? value : null;
}

/** Applies one remote `user_books` row. Returns true if anything changed locally. */
export function applyUserBook(tx: Tx, remote: HcUserBook): boolean {
    const hash = hashOf(remote);
    const existingId = findLinked(tx, "library_entry", remote.id);

    if (existingId) {
        const current = tx
            .select({ deletedAt: libraryEntries.deletedAt })
            .from(libraryEntries)
            .where(eq(libraryEntries.id, existingId))
            .get();
        const unchanged = current?.deletedAt === null && snapshotHash(tx, "library_entry", existingId) === hash;
        if (unchanged) return false;
    }

    const bookId = upsertBook(tx, remote.book);
    const editionId = remote.edition ? upsertEdition(tx, bookId, remote.edition) : null;

    // hiddenAt is local-only, so it's deliberately absent here.
    const values = {
        bookId,
        editionId,
        status: toStatus(remote.status_id),
        rating: toRating(remote.rating),
        review: remote.review_raw,
        owned: remote.owned ?? false,
        privacy: remote.privacy_setting_id,
        notes: remote.private_notes,
        addedAt: remote.date_added,
        deletedAt: null,
    };

    let entryId = existingId;
    if (entryId) {
        // Pending edits win until milestone 4 can push them.
        const pending = pendingFields(tx, "library_entry", entryId);
        const kept = Object.fromEntries(
            Object.entries(values).filter(([field]) => !pending.has(field)),
        ) as Partial<typeof values>;
        tx.update(libraryEntries).set(kept).where(eq(libraryEntries.id, entryId)).run();
    } else {
        entryId = crypto.randomUUID();
        tx.insert(libraryEntries).values({ id: entryId, ...values }).run();
        link(tx, "library_entry", entryId, remote.id);
    }

    const keptReadIds: string[] = [];
    for (const read of remote.user_book_reads) {
        const readValues = {
            libraryEntryId: entryId,
            startedAt: read.started_at,
            finishedAt: read.finished_at,
            progressPages: read.progress_pages,
            progressPercent: read.progress,
            deletedAt: null,
        };
        let readId = findLinked(tx, "read", read.id);
        if (readId) {
            tx.update(reads).set(readValues).where(eq(reads.id, readId)).run();
        } else {
            readId = crypto.randomUUID();
            tx.insert(reads).values({ id: readId, ...readValues }).run();
            link(tx, "read", readId, read.id);
        }
        keptReadIds.push(readId);
    }

    // Only reads that came from Hardcover can disappear from it. Local-only reads
    // (dates from imports, not pushed yet) stay.
    const hardcoverReadIds = tx
        .select({ id: externalIds.entityId })
        .from(externalIds)
        .where(and(eq(externalIds.source, "hardcover"), eq(externalIds.entityType, "read")));
    tx.update(reads)
        .set({ deletedAt: new Date().toISOString() })
        .where(
            and(
                eq(reads.libraryEntryId, entryId),
                isNull(reads.deletedAt),
                inArray(reads.id, hardcoverReadIds),
                keptReadIds.length > 0 ? notInArray(reads.id, keptReadIds) : undefined,
            ),
        )
        .run();

    saveSnapshot(tx, "library_entry", entryId, remote, hash);
    return true;
}

/** Sortable keys in remote order. Milestone 5 swaps these for real fractional indexes when drag reordering lands. */
function positionKey(index: number): string {
    return String(index).padStart(6, "0");
}

export interface ListApplyResult {
    changed: boolean;
    itemsRemoved: number;
}

/** Applies one remote list and its membership. */
export function applyList(tx: Tx, remote: HcList): ListApplyResult {
    const hash = hashOf(remote);
    const existingId = findLinked(tx, "list", remote.id);

    if (existingId) {
        const current = tx.select({ deletedAt: lists.deletedAt }).from(lists).where(eq(lists.id, existingId)).get();
        if (current?.deletedAt === null && snapshotHash(tx, "list", existingId) === hash) {
            return { changed: false, itemsRemoved: 0 };
        }
    }

    const values = {
        name: remote.name,
        slug: remote.slug,
        description: remote.description,
        privacy: remote.privacy_setting_id,
        ranked: remote.ranked ?? false,
        deletedAt: null,
    };

    let listId = existingId;
    if (listId) {
        tx.update(lists).set(values).where(eq(lists.id, listId)).run();
    } else {
        listId = crypto.randomUUID();
        tx.insert(lists).values({ id: listId, ...values }).run();
        link(tx, "list", listId, remote.id);
    }

    // Items with unsent local changes (adds or removals) are left exactly as they are,
    // and so are books that live here only, which Hardcover will never list.
    const pendingItems = pendingEntityIds(tx, "list_item");
    const localOnlyItems = tx
        .select({ id: listItems.id })
        .from(listItems)
        .innerJoin(books, eq(books.id, listItems.bookId))
        .where(and(eq(listItems.listId, listId), eq(books.localOnly, true)))
        .all()
        .map((item) => item.id);
    const keptItemIds: string[] = [...pendingItems, ...localOnlyItems];
    remote.list_books.forEach((listBook, index) => {
        const itemValues = {
            listId,
            bookId: upsertBook(tx, listBook.book),
            position: positionKey(index),
            deletedAt: null,
        };
        let itemId = findLinked(tx, "list_item", listBook.id);
        if (itemId && pendingItems.has(itemId)) return;
        if (itemId) {
            tx.update(listItems).set(itemValues).where(eq(listItems.id, itemId)).run();
        } else {
            itemId = crypto.randomUUID();
            tx.insert(listItems).values({ id: itemId, ...itemValues }).run();
            link(tx, "list_item", itemId, listBook.id);
        }
        keptItemIds.push(itemId);
    });

    const removed = tx
        .update(listItems)
        .set({ deletedAt: new Date().toISOString() })
        .where(
            and(
                eq(listItems.listId, listId),
                isNull(listItems.deletedAt),
                keptItemIds.length > 0 ? notInArray(listItems.id, keptItemIds) : undefined,
            ),
        )
        .run();

    saveSnapshot(tx, "list", listId, remote, hash);
    return { changed: true, itemsRemoved: removed.changes };
}

/** Local records linked to Hardcover that are still active, keyed by Hardcover id. */
export function activeLinked(entityType: "library_entry" | "list"): Map<string, string> {
    const table = entityType === "library_entry" ? libraryEntries : lists;
    const rows = db
        .select({ localId: table.id, externalId: externalIds.externalId })
        .from(table)
        .innerJoin(
            externalIds,
            and(
                eq(externalIds.entityId, table.id),
                eq(externalIds.entityType, entityType),
                eq(externalIds.source, "hardcover"),
            ),
        )
        .where(isNull(table.deletedAt))
        .all();
    return new Map(rows.map((row) => [row.externalId, row.localId]));
}

/** Active local items per Hardcover list id, keyed by Hardcover list_books id. */
export function activeListItemsByList(): Map<string, Set<string>> {
    const rows = db
        .select({ hcListId: externalIds.externalId, itemId: listItems.id })
        .from(listItems)
        .innerJoin(lists, eq(lists.id, listItems.listId))
        .innerJoin(
            externalIds,
            and(eq(externalIds.entityId, lists.id), eq(externalIds.entityType, "list"), eq(externalIds.source, "hardcover")),
        )
        .where(and(isNull(listItems.deletedAt), isNull(lists.deletedAt)))
        .all();
    const itemLinks = db
        .select({ localId: externalIds.entityId, externalId: externalIds.externalId })
        .from(externalIds)
        .where(and(eq(externalIds.entityType, "list_item"), eq(externalIds.source, "hardcover")))
        .all();
    const externalByLocal = new Map(itemLinks.map((row) => [row.localId, row.externalId]));

    const result = new Map<string, Set<string>>();
    for (const row of rows) {
        const externalItemId = externalByLocal.get(row.itemId);
        if (!externalItemId) continue;
        const set = result.get(row.hcListId) ?? new Set<string>();
        set.add(externalItemId);
        result.set(row.hcListId, set);
    }
    return result;
}

export function softDeleteEntries(tx: Tx, localIds: string[]): void {
    if (localIds.length === 0) return;
    tx.update(libraryEntries)
        .set({ deletedAt: new Date().toISOString() })
        .where(inArray(libraryEntries.id, localIds))
        .run();
}

export function softDeleteLists(tx: Tx, localIds: string[]): void {
    if (localIds.length === 0) return;
    const now = new Date().toISOString();
    tx.update(lists).set({ deletedAt: now }).where(inArray(lists.id, localIds)).run();
    tx.update(listItems)
        .set({ deletedAt: now })
        .where(and(inArray(listItems.listId, localIds), isNull(listItems.deletedAt)))
        .run();
}
