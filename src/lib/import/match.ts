import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
    books,
    editions,
    externalIds,
    type ImportCandidate,
    type ImportMatchSource,
    type ImportMatchStatus,
    type ParsedImportRow,
} from "@/db/schema";
import { HardcoverError } from "@/lib/hardcover/client";
import type { HcBook } from "@/lib/hardcover/library";
import { findEditions, searchBooks, type HcEditionWithBook } from "@/lib/hardcover/lookup";
import { log } from "@/lib/log";
import { lastName, mainTitle, normalizeText, titleAuthorKey } from "./normalize";

export interface RowMatch {
    matchStatus: ImportMatchStatus;
    matchSource: ImportMatchSource | null;
    bookId: string | null;
    match: ImportCandidate | null;
    candidates: ImportCandidate[] | null;
    note: string | null;
}

export interface RowToMatch {
    id: string;
    parsed: ParsedImportRow | null;
    error: string | null;
}

const SEARCH_RESULTS = 5;

/** Rows with nothing for the app to do: no reading status, and not a physical copy you own. */
export function hasWork(parsed: ParsedImportRow): boolean {
    return parsed.status !== null || (parsed.owned && parsed.physical);
}

function authorsOf(book: HcBook): string[] {
    return (book.cached_contributors ?? [])
        .filter((c) => c.author?.name && (!c.contribution || c.contribution === "Author"))
        .map((c) => c.author?.name ?? "");
}

function yearOf(date: string | null): number | null {
    const year = date ? Number.parseInt(date.slice(0, 4), 10) : Number.NaN;
    return Number.isFinite(year) ? year : null;
}

export function candidateFromEdition(edition: HcEditionWithBook): ImportCandidate {
    return {
        hcBookId: edition.book.id,
        hcEditionId: edition.id,
        title: edition.book.title,
        authors: authorsOf(edition.book),
        year: yearOf(edition.book.release_date),
        imageUrl: edition.book.cached_image?.url ?? null,
        readers: 0,
    };
}

function sameAuthor(rowAuthors: string[], candidateAuthors: string[]): boolean {
    if (rowAuthors.length === 0) return true;
    // Any word of their names, so "Shirow Masamune" still matches "Masamune Shirow".
    const theirs = new Set(candidateAuthors.flatMap((name) => normalizeText(name).split(" ")));
    return rowAuthors.some((author) => theirs.has(lastName(author)));
}

function sameTitle(rowTitle: string, candidateTitle: string): boolean {
    const squash = (value: string) => value.replace(/ /g, "");
    return (
        squash(normalizeText(rowTitle)) === squash(normalizeText(candidateTitle)) ||
        squash(mainTitle(rowTitle)) === squash(mainTitle(candidateTitle))
    );
}

/** Local books, keyed every way an import row can find them. */
function localIndex() {
    const byIsbn = new Map<string, { bookId: string; editionId: string }>();
    for (const edition of db
        .select({ id: editions.id, bookId: editions.bookId, isbn13: editions.isbn13, isbn10: editions.isbn10 })
        .from(editions)
        .where(isNull(editions.deletedAt))
        .all()) {
        if (edition.isbn13) byIsbn.set(edition.isbn13, { bookId: edition.bookId, editionId: edition.id });
        if (edition.isbn10) byIsbn.set(edition.isbn10, { bookId: edition.bookId, editionId: edition.id });
    }

    const byTitle = new Map<string, string>();
    const bookRows = db
        .select({ id: books.id, title: books.title, authors: books.authors, coverUrl: books.coverUrl })
        .from(books)
        .where(isNull(books.deletedAt))
        .all();
    for (const book of bookRows) byTitle.set(titleAuthorKey(book.title, book.authors), book.id);

    const hcBookIds = new Map<string, number>();
    const hcToLocal = new Map<number, string>();
    for (const link of db
        .select({ entityId: externalIds.entityId, externalId: externalIds.externalId })
        .from(externalIds)
        .where(and(eq(externalIds.source, "hardcover"), eq(externalIds.entityType, "book")))
        .all()) {
        hcBookIds.set(link.entityId, Number(link.externalId));
        hcToLocal.set(Number(link.externalId), link.entityId);
    }
    const hcEditionIds = new Map<string, number>();
    for (const link of db
        .select({ entityId: externalIds.entityId, externalId: externalIds.externalId })
        .from(externalIds)
        .where(and(eq(externalIds.source, "hardcover"), eq(externalIds.entityType, "edition")))
        .all()) {
        hcEditionIds.set(link.entityId, Number(link.externalId));
    }

    const booksById = new Map(bookRows.map((book) => [book.id, book]));
    function candidateFor(bookId: string, editionId: string | null): ImportCandidate | null {
        const book = booksById.get(bookId);
        const hcBookId = hcBookIds.get(bookId);
        if (!book || hcBookId === undefined) return null;
        return {
            hcBookId,
            hcEditionId: editionId ? (hcEditionIds.get(editionId) ?? null) : null,
            title: book.title,
            authors: book.authors,
            year: null,
            imageUrl: book.coverUrl,
            readers: 0,
        };
    }

    return { byIsbn, byTitle, hcToLocal, candidateFor };
}

/**
 * Finds each row's book: locally first, then by ISBN on Hardcover, then by
 * title + author search. Anything uncertain is left for review, never guessed.
 */
export async function matchRows(rows: RowToMatch[]): Promise<Map<string, RowMatch>> {
    const results = new Map<string, RowMatch>();
    const local = localIndex();
    const remaining: { id: string; parsed: ParsedImportRow }[] = [];

    for (const row of rows) {
        if (!row.parsed) {
            results.set(row.id, skipped(row.error ?? "Couldn't read this row"));
            continue;
        }
        if (!hasWork(row.parsed)) {
            results.set(row.id, skipped("Nothing to import: no reading status, and not a physical copy you own"));
            continue;
        }
        const { parsed } = row;
        const byIsbn =
            (parsed.isbn13 ? local.byIsbn.get(parsed.isbn13) : undefined) ??
            (parsed.isbn10 ? local.byIsbn.get(parsed.isbn10) : undefined);
        const bookId = byIsbn?.bookId ?? local.byTitle.get(titleAuthorKey(parsed.title, parsed.authors));
        if (bookId) {
            results.set(row.id, {
                matchStatus: "matched",
                matchSource: "local",
                bookId,
                match: local.candidateFor(bookId, byIsbn?.editionId ?? null),
                candidates: null,
                note: null,
            });
            continue;
        }
        remaining.push({ id: row.id, parsed });
    }

    // ISBN / ASIN lookups: a handful of requests for the whole file.
    const editionsFound = await findEditions({
        isbn13: remaining.flatMap((row) => (row.parsed.isbn13 ? [row.parsed.isbn13] : [])),
        isbn10: remaining.flatMap((row) => (row.parsed.isbn10 ? [row.parsed.isbn10] : [])),
        asin: remaining.flatMap((row) => (row.parsed.asin ? [row.parsed.asin] : [])),
    });
    const editionByKey = new Map<string, HcEditionWithBook>();
    for (const edition of editionsFound) {
        for (const key of [edition.isbn_13, edition.isbn_10, edition.asin]) {
            if (key && !editionByKey.has(key)) editionByKey.set(key, edition);
        }
    }

    const toSearch: typeof remaining = [];
    for (const row of remaining) {
        const { parsed } = row;
        const edition = [parsed.isbn13, parsed.isbn10, parsed.asin]
            .map((key) => (key ? editionByKey.get(key) : undefined))
            .find((found) => found !== undefined);
        if (edition) {
            results.set(row.id, {
                matchStatus: "matched",
                matchSource: "isbn",
                bookId: local.hcToLocal.get(edition.book.id) ?? null,
                match: candidateFromEdition(edition),
                candidates: null,
                note: null,
            });
        } else {
            toSearch.push(row);
        }
    }

    for (const row of toSearch) {
        const { parsed } = row;
        try {
            const query = [parsed.title, parsed.authors[0]].filter(Boolean).join(" ");
            const candidates = await searchBooks(query, SEARCH_RESULTS);
            const confident = candidates
                .filter((c) => sameTitle(parsed.title, c.title) && sameAuthor(parsed.authors, c.authors))
                .sort((a, b) => b.readers - a.readers)[0];
            if (confident) {
                results.set(row.id, {
                    matchStatus: "matched",
                    matchSource: "search",
                    bookId: local.hcToLocal.get(confident.hcBookId) ?? null,
                    match: confident,
                    candidates,
                    note: null,
                });
            } else {
                results.set(row.id, {
                    matchStatus: "needs_review",
                    matchSource: null,
                    bookId: null,
                    match: null,
                    candidates,
                    note: candidates.length === 0 ? "Hardcover search found nothing" : "No confident match",
                });
            }
        } catch (error) {
            if (error instanceof HardcoverError && error.kind !== "graphql") throw error;
            void log.warn("Hardcover search failed for an import row", { title: parsed.title }, error);
            results.set(row.id, {
                matchStatus: "needs_review",
                matchSource: null,
                bookId: null,
                match: null,
                candidates: [],
                note: "Hardcover search failed for this one",
            });
        }
    }

    return results;
}

function skipped(note: string): RowMatch {
    return { matchStatus: "skipped", matchSource: null, bookId: null, match: null, candidates: null, note };
}
