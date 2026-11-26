import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
    books,
    editions,
    importRows,
    imports,
    type BookDetailField,
    type BookDetails,
    type HardcoverPrep,
    type ImportCandidate,
    type ParsedImportRow,
} from "@/db/schema";
import { HardcoverError } from "@/lib/hardcover/client";
import { searchAuthors, searchPublishers } from "@/lib/hardcover/lookup";
import { insertBook, type NewBookDto } from "@/lib/hardcover/mutations";
import { log } from "@/lib/log";
import { findByIsbn, OpenLibraryError, searchByTitle } from "@/lib/openlibrary/client";
import { findLinked } from "@/lib/sync/apply";
import { normalizeText } from "./normalize";

/** Fields Open Library can fill, in the order they're shown. */
export const DETAIL_FIELDS: BookDetailField[] = [
    "title",
    "subtitle",
    "authors",
    "publisher",
    "publishDate",
    "pages",
    "isbn13",
    "isbn10",
    "coverUrl",
];

/** The row's own details from the CSV: the starting point for a draft. */
export function draftFromRow(parsed: ParsedImportRow): BookDetails {
    return {
        title: parsed.title || null,
        subtitle: null,
        authors: parsed.authors,
        publisher: null,
        publishDate: null,
        pages: null,
        isbn13: parsed.isbn13,
        isbn10: parsed.isbn10,
        coverUrl: null,
    };
}

function isEmpty(value: BookDetails[BookDetailField]): boolean {
    return value === null || (Array.isArray(value) && value.length === 0);
}

/** Open Library fields that would fill a blank in the draft. It never replaces a value. */
export function offeredFields(draft: BookDetails, openLibrary: BookDetails): BookDetailField[] {
    return DETAIL_FIELDS.filter((field) => isEmpty(draft[field]) && !isEmpty(openLibrary[field]));
}

function editableRow(rowId: string) {
    const row = db.select().from(importRows).where(eq(importRows.id, rowId)).get();
    if (!row || row.deletedAt || row.committedAt || !row.parsed) throw new Error("That row is gone or already imported");
    const record = db.select({ status: imports.status }).from(imports).where(eq(imports.id, row.importId)).get();
    if (record?.status !== "review") throw new Error("This import can't be changed any more");
    return { ...row, parsed: row.parsed };
}

/** Asks Open Library about a row Hardcover couldn't match: ISBN first, then title + author. */
export async function lookUpOpenLibrary(rowId: string): Promise<void> {
    const row = editableRow(rowId);
    const { parsed } = row;
    let found: BookDetails | null = null;
    for (const isbn of [parsed.isbn13, parsed.isbn10]) {
        if (!found && isbn) found = await findByIsbn(isbn);
    }
    if (!found) found = await searchByTitle(parsed.title, parsed.authors[0] ?? null);

    db.update(importRows)
        .set({
            openLibrary: found,
            openLibraryStatus: found ? "found" : "not_found",
            draft: row.draft ?? draftFromRow(parsed),
            hardcoverPrep: null,
        })
        .where(eq(importRows.id, rowId))
        .run();
}

/** Open Library lookups for every unmatched row in an import. Read-only, so it runs without asking. */
export async function lookUpUnmatched(rowIds: string[]): Promise<void> {
    for (const rowId of rowIds) {
        try {
            await lookUpOpenLibrary(rowId);
        } catch (error) {
            if (!(error instanceof OpenLibraryError)) throw error;
            void log.warn("Open Library lookup failed for an import row", { rowId }, error);
        }
    }
}

function setDraft(rowId: string, draft: BookDetails): void {
    // Any change to the draft means the Hardcover prep has to be redone.
    db.update(importRows).set({ draft, hardcoverPrep: null }).where(eq(importRows.id, rowId)).run();
}

export function acceptField(rowId: string, field: BookDetailField): void {
    const row = editableRow(rowId);
    if (!row.openLibrary || !DETAIL_FIELDS.includes(field)) throw new Error("Nothing to fill in there");
    const draft = row.draft ?? draftFromRow(row.parsed);
    if (!offeredFields(draft, row.openLibrary).includes(field)) return;
    setDraft(rowId, { ...draft, [field]: row.openLibrary[field] });
}

export function acceptAllFields(rowId: string): void {
    const row = editableRow(rowId);
    if (!row.openLibrary) throw new Error("Nothing to fill in");
    const draft = { ...(row.draft ?? draftFromRow(row.parsed)) };
    for (const field of offeredFields(draft, row.openLibrary)) {
        (draft as Record<BookDetailField, unknown>)[field] = row.openLibrary[field];
    }
    setDraft(rowId, draft);
}

export function skipOpenLibrary(rowId: string): void {
    editableRow(rowId);
    db.update(importRows)
        .set({ openLibraryStatus: "skipped", hardcoverPrep: null })
        .where(eq(importRows.id, rowId))
        .run();
}

/** "Loren C. Eiseley" and "Loren Eiseley" both → "loren eiseley". */
function nameKey(name: string): string {
    const parts = normalizeText(name)
        .split(" ")
        .filter((part) => part.length > 1);
    return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : (parts[0] ?? "");
}

/**
 * Finds the Hardcover records the draft would be sent with. Nothing is created:
 * an author Hardcover doesn't have blocks the add, and a publisher it doesn't
 * have is just left off.
 */
export async function prepareForHardcover(rowId: string): Promise<HardcoverPrep> {
    const row = editableRow(rowId);
    const draft = row.draft ?? draftFromRow(row.parsed);
    if (!draft.title) throw new Error("A title is needed first");
    if (draft.authors.length === 0) throw new Error("At least one author is needed first");

    const authors: HardcoverPrep["authors"] = [];
    // StoryGraph sometimes lists the same author twice ("Ernest Hemingway, Ernest Hemingway").
    const uniqueNames = [...new Map(draft.authors.map((name) => [nameKey(name), name])).values()];
    for (const name of uniqueNames) {
        const key = nameKey(name);
        const best = (await searchAuthors(name))
            .filter((hit) => nameKey(hit.name) === key || hit.alternateNames.some((alt) => nameKey(alt) === key))
            .sort((a, b) => b.books - a.books)[0];
        authors.push({ name, id: best?.id ?? null, hcName: best?.name ?? null, books: best?.books ?? 0 });
    }

    let publisher: HardcoverPrep["publisher"] = null;
    if (draft.publisher) {
        const wanted = normalizeText(draft.publisher);
        const hit = (await searchPublishers(draft.publisher)).find((p) => normalizeText(p.name) === wanted);
        publisher = hit ? { id: hit.id, name: hit.name } : null;
    }

    const prep: HardcoverPrep = { authors, publisher, preparedAt: new Date().toISOString() };
    db.update(importRows).set({ hardcoverPrep: prep }).where(eq(importRows.id, rowId)).run();
    return prep;
}

function toDto(draft: BookDetails, prep: HardcoverPrep, format: string | null): NewBookDto {
    const dto: NewBookDto = {
        title: draft.title ?? "",
        contributions: [...new Set(prep.authors.flatMap((author) => (author.id !== null ? [author.id] : [])))].map(
            (authorId) => ({ author_id: authorId }),
        ),
    };
    if (draft.subtitle) dto.subtitle = draft.subtitle;
    if (draft.isbn13) dto.isbn_13 = draft.isbn13;
    if (draft.isbn10) dto.isbn_10 = draft.isbn10;
    if (draft.pages) dto.page_count = draft.pages;
    if (draft.publishDate) dto.release_date = draft.publishDate.length === 4 ? `${draft.publishDate}-01-01` : draft.publishDate;
    if (format === "paperback") dto.edition_format = "Paperback";
    if (format === "hardcover") dto.edition_format = "Hardcover";
    if (prep.publisher) dto.publisher_id = prep.publisher.id;
    return dto;
}

/**
 * Creates this one book on Hardcover, then matches the row to it so the import
 * carries on as usual. Public and hard to undo, so it only runs on a click.
 */
export async function addToHardcover(rowId: string): Promise<{ created: boolean; title: string }> {
    const row = editableRow(rowId);
    const draft = row.draft ?? draftFromRow(row.parsed);
    const prep = row.hardcoverPrep;
    if (!prep) throw new Error("Check the details with Hardcover first");
    const missing = prep.authors.filter((author) => author.id === null).map((author) => author.name);
    if (missing.length > 0) throw new Error(`Hardcover doesn't have ${missing.join(", ")} yet`);

    let inserted;
    try {
        inserted = await insertBook(toDto(draft, prep, row.parsed.format));
    } catch (error) {
        void log.error("Adding a book to Hardcover failed", { rowId, title: draft.title }, error);
        throw error instanceof HardcoverError && error.kind === "graphql"
            ? new Error(`Hardcover said no: ${error.message}`)
            : error;
    }
    void log.warn(inserted.created ? "Created a book on Hardcover" : "Hardcover matched an existing book", {
        rowId,
        hcBookId: inserted.book.id,
        editionId: inserted.editionId,
        matchedBy: inserted.matchedBy,
    });

    const match: ImportCandidate = {
        hcBookId: inserted.book.id,
        hcEditionId: inserted.editionId,
        title: inserted.book.title,
        authors: prep.authors.map((author) => author.hcName ?? author.name),
        year: draft.publishDate ? Number.parseInt(draft.publishDate.slice(0, 4), 10) : null,
        imageUrl: inserted.book.cached_image?.url ?? null,
        readers: 0,
    };
    db.transaction((tx) => {
        tx.update(importRows)
            .set({
                matchStatus: "matched",
                matchSource: "created",
                match,
                bookId: findLinked(tx, "book", inserted.book.id) ?? null,
                note: inserted.created ? "Added to Hardcover by you" : "Hardcover already had it",
            })
            .where(eq(importRows.id, rowId))
            .run();
    });
    return { created: inserted.created, title: inserted.book.title };
}

/**
 * Makes the book in this app only, from the row's details (plus any Open
 * Library fields you accepted). Hardcover never hears about it, and the row
 * then imports like any other (Owned list, status).
 */
export function keepHereOnly(rowId: string): void {
    const row = editableRow(rowId);
    const draft = row.draft ?? draftFromRow(row.parsed);
    if (!draft.title) throw new Error("A title is needed first");

    db.transaction((tx) => {
        const bookId = crypto.randomUUID();
        tx.insert(books)
            .values({
                id: bookId,
                title: draft.title ?? "",
                subtitle: draft.subtitle,
                authors: [...new Map(draft.authors.map((name) => [nameKey(name), name])).values()],
                coverUrl: draft.coverUrl,
                pageCount: draft.pages,
                firstPublished: draft.publishDate,
                localOnly: true,
            })
            .run();
        if (draft.isbn13 || draft.isbn10 || draft.publisher || draft.pages) {
            tx.insert(editions)
                .values({
                    bookId,
                    isbn13: draft.isbn13,
                    isbn10: draft.isbn10,
                    publisher: draft.publisher,
                    pages: draft.pages,
                    format: row.parsed.format,
                })
                .run();
        }
        tx.update(importRows)
            .set({
                matchStatus: "matched",
                matchSource: "kept",
                match: null,
                bookId,
                hardcoverPrep: null,
                note: "Kept here only",
            })
            .where(eq(importRows.id, rowId))
            .run();
    });
}
