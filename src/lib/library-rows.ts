import "server-only";

import { and, eq, isNotNull, isNull, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { books, libraryEntries, listItems, type ReadingStatus } from "@/db/schema";
import { ownedListId } from "@/lib/list-membership";
import { sortRows } from "@/lib/library-sort";

export const visibleEntries = and(isNull(libraryEntries.deletedAt), isNull(libraryEntries.hiddenAt));
export const hiddenEntries = and(isNull(libraryEntries.deletedAt), isNotNull(libraryEntries.hiddenAt));

export interface LibraryRow {
    id: string;
    bookId: string;
    status: ReadingStatus | null;
    rating: number | null;
    owned: boolean;
    addedAt: string | null;
    addedStamp: string | null;
    published: string | null;
    title: string;
    subtitle: string | null;
    authors: string[];
    coverUrl: string | null;
}

/** Library entries (books with a reading status) matching `where`. */
export function loadEntries(where: SQL | undefined): LibraryRow[] {
    return db
        .select({
            id: libraryEntries.id,
            bookId: books.id,
            status: libraryEntries.status,
            rating: libraryEntries.rating,
            owned: libraryEntries.owned,
            addedAt: libraryEntries.addedAt,
            addedStamp: libraryEntries.createdAt,
            published: books.firstPublished,
            title: books.title,
            subtitle: books.subtitle,
            authors: books.authors,
            coverUrl: books.coverUrl,
        })
        .from(libraryEntries)
        .innerJoin(books, eq(books.id, libraryEntries.bookId))
        .where(where)
        .all();
}

/** Every book on a list, including ones with no reading status. Hidden books stay hidden. */
export function loadListBooks(listId: string): LibraryRow[] {
    return db
        .select({
            id: listItems.id,
            bookId: books.id,
            status: libraryEntries.status,
            rating: libraryEntries.rating,
            owned: libraryEntries.owned,
            hiddenAt: libraryEntries.hiddenAt,
            addedAt: libraryEntries.addedAt,
            listedAt: listItems.createdAt,
            published: books.firstPublished,
            title: books.title,
            subtitle: books.subtitle,
            authors: books.authors,
            coverUrl: books.coverUrl,
        })
        .from(listItems)
        .innerJoin(books, eq(books.id, listItems.bookId))
        .leftJoin(libraryEntries, and(eq(libraryEntries.bookId, books.id), isNull(libraryEntries.deletedAt)))
        .where(and(eq(listItems.listId, listId), isNull(listItems.deletedAt), isNull(books.deletedAt)))
        .all()
        .filter((row) => row.hiddenAt === null)
        .map((row) => ({
            id: row.id,
            bookId: row.bookId,
            status: row.status,
            rating: row.rating,
            owned: row.owned ?? false,
            addedAt: row.addedAt ?? row.listedAt.slice(0, 10),
            addedStamp: row.listedAt,
            published: row.published,
            title: row.title,
            subtitle: row.subtitle,
            authors: row.authors,
            coverUrl: row.coverUrl,
        }));
}

/** The whole hoard: books with a reading status plus Owned books that don't have one. */
export function loadEverything(): LibraryRow[] {
    const entries = loadEntries(visibleEntries);
    const listId = ownedListId();
    if (!listId) return entries;
    const seen = new Set(entries.map((row) => row.bookId));
    const ownedOnly = loadListBooks(listId).filter((row) => row.status === null && !seen.has(row.bookId));
    return [...entries, ...ownedOnly];
}

/** Newest additions to the hoard, for the home page. */
export function recentlyAdded(limit: number): LibraryRow[] {
    return sortRows(loadEverything(), "added", "desc").slice(0, limit);
}
