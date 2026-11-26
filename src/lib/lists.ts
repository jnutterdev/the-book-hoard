import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { lists } from "@/db/schema";
import { loadListBooks, type LibraryRow } from "@/lib/library-rows";
import { sortRows } from "@/lib/library-sort";

export interface ListSummary {
    id: string;
    name: string;
    description: string | null;
    count: number;
    /** When a book last went on the list (full timestamp), or null for an empty list. */
    lastAddedAt: string | null;
    /** Up to four of the newest books, ones with covers first, for the card's cover fan. */
    newest: LibraryRow[];
}

function summarize(list: { id: string; name: string; description: string | null }): ListSummary {
    const newest = sortRows(loadListBooks(list.id), "added", "desc");
    return {
        ...list,
        count: newest.length,
        lastAddedAt: newest[0]?.addedStamp ?? null,
        // Covers make the fan; a book without one only shows if nothing else has a cover.
        newest: [...newest.filter((book) => book.coverUrl), ...newest.filter((book) => !book.coverUrl)].slice(0, 4),
    };
}

/** Every list, the one you last added a book to first. Empty lists go last, by name. */
export function listSummaries(): ListSummary[] {
    return db
        .select({ id: lists.id, name: lists.name, description: lists.description })
        .from(lists)
        .where(isNull(lists.deletedAt))
        .all()
        .map(summarize)
        .sort((a, b) => {
            if (a.lastAddedAt === b.lastAddedAt) return a.name.localeCompare(b.name);
            if (a.lastAddedAt === null) return 1;
            if (b.lastAddedAt === null) return -1;
            return b.lastAddedAt.localeCompare(a.lastAddedAt);
        });
}

export function findList(id: string) {
    return db
        .select({ id: lists.id, name: lists.name, description: lists.description })
        .from(lists)
        .where(and(eq(lists.id, id), isNull(lists.deletedAt)))
        .get();
}
