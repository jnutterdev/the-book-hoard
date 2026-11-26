import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
    importRows,
    imports,
    libraryEntries,
    reads,
    type ImportCandidate,
    type ImportChoice,
} from "@/db/schema";
import { fetchBooks, fetchEditions, searchBooks } from "@/lib/hardcover/lookup";
import { localDate } from "@/lib/dates";
import { ownedListId, setListMembership } from "@/lib/list-membership";
import { log } from "@/lib/log";
import { enqueue } from "@/lib/outbox";
import { findLinked, upsertBook, upsertEdition } from "@/lib/sync/apply";
import { matchRows } from "./match";
import { getImportPreview, planRows, type DiffField } from "./plan";
import { parseStoryGraphCsv } from "./storygraph";

/** Parses a StoryGraph export, saves every row, and matches what it can. Returns the import id. */
export async function createStoryGraphImport(filename: string, csv: string): Promise<string> {
    const { rows } = parseStoryGraphCsv(csv);
    if (rows.length === 0) throw new Error("That file has no rows");

    const importId = crypto.randomUUID();
    const rowIds: string[] = [];
    db.transaction((tx) => {
        tx.insert(imports)
            .values({ id: importId, source: "storygraph", filename, rowCount: rows.length, status: "parsing" })
            .run();
        for (const row of rows) {
            const id = crypto.randomUUID();
            rowIds.push(id);
            tx.insert(importRows)
                .values({
                    id,
                    importId,
                    raw: row.raw,
                    parsed: row.parsed,
                    matchStatus: "needs_review",
                    note: row.error,
                })
                .run();
        }
    });

    try {
        const matches = await matchRows(
            rows.map((row, i) => ({ id: rowIds[i] ?? "", parsed: row.parsed, error: row.error })),
        );
        db.transaction((tx) => {
            let matched = 0;
            let unmatched = 0;
            for (const [rowId, match] of matches) {
                if (match.matchStatus === "matched") matched++;
                if (match.matchStatus === "needs_review") unmatched++;
                tx.update(importRows).set(match).where(eq(importRows.id, rowId)).run();
            }
            tx.update(imports).set({ status: "review", matched, unmatched }).where(eq(imports.id, importId)).run();
        });
    } catch (error) {
        db.update(imports).set({ status: "failed" }).where(eq(imports.id, importId)).run();
        void log.error("StoryGraph import failed while matching", { importId }, error);
        throw error;
    }
    return importId;
}

function reviewRow(rowId: string) {
    const row = db.select().from(importRows).where(eq(importRows.id, rowId)).get();
    if (!row || row.deletedAt || row.committedAt) throw new Error("That row is gone or already imported");
    const record = db.select({ status: imports.status }).from(imports).where(eq(imports.id, row.importId)).get();
    if (record?.status !== "review") throw new Error("This import can't be changed any more");
    return row;
}

/** Matches a review row to one of its candidates. */
export function pickCandidate(rowId: string, hcBookId: number): void {
    const row = reviewRow(rowId);
    const candidate = row.candidates?.find((c) => c.hcBookId === hcBookId);
    if (!candidate) throw new Error("That book isn't one of the choices");
    db.transaction((tx) => {
        tx.update(importRows)
            .set({
                matchStatus: "matched",
                matchSource: "manual",
                match: candidate,
                bookId: findLinked(tx, "book", candidate.hcBookId) ?? null,
                note: null,
            })
            .where(eq(importRows.id, rowId))
            .run();
    });
}

export function skipRow(rowId: string): void {
    reviewRow(rowId);
    db.update(importRows)
        .set({ matchStatus: "skipped", match: null, bookId: null, note: "Skipped by you" })
        .where(eq(importRows.id, rowId))
        .run();
}

/** Sends a row back to review, e.g. to fix a wrong automatic match. */
export function unmatchRow(rowId: string): void {
    const row = reviewRow(rowId);
    const candidates: ImportCandidate[] = row.candidates ?? (row.match ? [row.match] : []);
    db.update(importRows)
        .set({ matchStatus: "needs_review", match: null, bookId: null, candidates, choices: null, note: "Sent back to review" })
        .where(eq(importRows.id, rowId))
        .run();
}

export async function searchAgain(rowId: string, query: string): Promise<void> {
    reviewRow(rowId);
    const trimmed = query.trim();
    if (!trimmed) throw new Error("Type something to search for");
    const candidates = await searchBooks(trimmed, 8);
    db.update(importRows)
        .set({ candidates, note: candidates.length === 0 ? `Nothing found for "${trimmed}"` : null })
        .where(eq(importRows.id, rowId))
        .run();
}

export function setChoice(rowId: string, field: DiffField, choice: ImportChoice): void {
    const row = reviewRow(rowId);
    db.update(importRows)
        .set({ choices: { ...(row.choices ?? {}), [field]: choice } })
        .where(eq(importRows.id, rowId))
        .run();
}

/** Every open difference in an import set to one side. */
export function setAllChoices(importId: string, choice: ImportChoice): void {
    const preview = getImportPreview(importId);
    if (!preview || preview.status !== "review") throw new Error("This import can't be changed any more");
    db.transaction((tx) => {
        for (const plan of preview.differences) {
            const choices = Object.fromEntries(plan.diffs.map((diff) => [diff.field, choice]));
            tx.update(importRows).set({ choices }).where(eq(importRows.id, plan.rowId)).run();
        }
    });
}

export function discardImport(importId: string): void {
    db.update(imports)
        .set({ deletedAt: new Date().toISOString() })
        .where(and(eq(imports.id, importId), isNull(imports.deletedAt)))
        .run();
}

export interface CommitSummary {
    addedToLibrary: number;
    updated: number;
    ownedAdded: number;
    readsSaved: number;
}

/**
 * Writes the import into the library in one go. Every change lands in the
 * outbox, so it reaches Hardcover on the next sync like any other edit.
 */
export async function commitImport(importId: string): Promise<CommitSummary> {
    const preview = getImportPreview(importId);
    if (!preview) throw new Error("Import not found");
    if (!preview.ready) throw new Error("Finish the review and pick every difference first");

    const rows = db
        .select()
        .from(importRows)
        .where(and(eq(importRows.importId, importId), isNull(importRows.deletedAt)))
        .all();
    const plans = planRows(rows);
    const listId = ownedListId();
    if (!listId && plans.some((plan) => plan.ownedAdd)) {
        throw new Error("The Owned list hasn't come in from Hardcover yet. Run a sync first.");
    }

    // Hardcover details for books and editions this app hasn't seen yet.
    const newBookIds = plans.filter((plan) => !plan.bookId && plan.match).map((plan) => plan.match?.hcBookId ?? 0);
    const editionIds = plans.flatMap((plan) => (plan.match?.hcEditionId ? [plan.match.hcEditionId] : []));
    const hcBooks = new Map((await fetchBooks(newBookIds)).map((book) => [book.id, book]));
    const hcEditions = new Map((await fetchEditions(editionIds)).map((edition) => [edition.id, edition]));

    const summary: CommitSummary = { addedToLibrary: 0, updated: 0, ownedAdded: 0, readsSaved: 0 };
    const now = new Date().toISOString();

    db.transaction((tx) => {
        for (const plan of plans) {
            const match = plan.match;
            let bookId = plan.bookId ?? (match ? findLinked(tx, "book", match.hcBookId) : undefined) ?? null;
            if (!bookId && match) {
                const book = hcBooks.get(match.hcBookId);
                if (book) bookId = upsertBook(tx, book);
            }
            if (!bookId) {
                void log.warn("Import row skipped at commit: book details missing", { rowId: plan.rowId });
                continue;
            }

            let editionId: string | null = null;
            if (match?.hcEditionId) {
                editionId = findLinked(tx, "edition", match.hcEditionId) ?? null;
                const edition = hcEditions.get(match.hcEditionId);
                if (!editionId && edition && edition.book.id === match.hcBookId) {
                    editionId = upsertEdition(tx, bookId, edition);
                }
            }

            let entry = tx
                .select()
                .from(libraryEntries)
                .where(and(eq(libraryEntries.bookId, bookId), isNull(libraryEntries.deletedAt)))
                .get();

            if (plan.addToLibrary && !entry) {
                const id = crypto.randomUUID();
                tx.insert(libraryEntries)
                    .values({
                        id,
                        bookId,
                        editionId,
                        status: plan.addToLibrary.status,
                        rating: plan.addToLibrary.rating,
                        owned: plan.parsed.owned && plan.parsed.physical,
                        addedAt: localDate(new Date()),
                    })
                    .run();
                enqueue(tx, "library_entry", id, "create");
                entry = tx.select().from(libraryEntries).where(eq(libraryEntries.id, id)).get();
                summary.addedToLibrary++;
            }

            if (entry) {
                const values: Record<string, unknown> = {};
                const bases: Record<string, unknown> = {};
                for (const diff of plan.diffs) {
                    if (diff.choice !== "import") continue;
                    values[diff.field] = diff.incoming;
                    bases[diff.field] = (entry as Record<string, unknown>)[diff.field];
                }
                if (Object.keys(values).length > 0) {
                    tx.update(libraryEntries).set(values).where(eq(libraryEntries.id, entry.id)).run();
                    enqueue(tx, "library_entry", entry.id, "update", Object.keys(values), bases);
                    summary.updated++;
                }
                // Read dates stay local until v2 sends read history.
                for (const date of plan.newReads) {
                    tx.insert(reads).values({ libraryEntryId: entry.id, finishedAt: date }).run();
                    summary.readsSaved++;
                }
                if (plan.ownedAdd && !entry.owned) {
                    tx.update(libraryEntries).set({ owned: true }).where(eq(libraryEntries.id, entry.id)).run();
                }
            }

            if (plan.ownedAdd && listId) {
                setListMembership(tx, bookId, listId, true, editionId);
                summary.ownedAdded++;
            }

            tx.update(importRows).set({ committedAt: now, bookId }).where(eq(importRows.id, plan.rowId)).run();
        }
        tx.update(imports).set({ status: "committed" }).where(eq(imports.id, importId)).run();
    });

    return summary;
}
