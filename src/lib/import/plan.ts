import "server-only";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
    importRows,
    imports,
    libraryEntries,
    reads,
    type BookDetailField,
    type BookDetails,
    type HardcoverPrep,
    type ImportCandidate,
    type ImportChoice,
    type ParsedImportRow,
    type ReadingStatus,
} from "@/db/schema";
import { ownedBookIds } from "@/lib/list-membership";
import { draftFromRow, offeredFields } from "./rescue";

export type DiffField = "status" | "rating";

export interface FieldDiff {
    field: DiffField;
    current: number | null;
    incoming: number | null;
    choice: ImportChoice | null;
}

export interface RowPlan {
    rowId: string;
    parsed: ParsedImportRow;
    match: ImportCandidate | null;
    bookId: string | null;
    /** Set when the book isn't in the library yet and the row has a status. */
    addToLibrary: { status: ReadingStatus; rating: number | null } | null;
    entryId: string | null;
    diffs: FieldDiff[];
    ownedAdd: boolean;
    newReads: string[];
}

export interface ReviewRow {
    rowId: string;
    parsed: ParsedImportRow;
    candidates: ImportCandidate[];
    note: string | null;
    openLibrary: {
        status: "found" | "not_found" | "skipped" | null;
        found: BookDetails | null;
        draft: BookDetails;
        offered: BookDetailField[];
        prep: HardcoverPrep | null;
    };
}

export interface SkippedRow {
    rowId: string;
    title: string;
    note: string;
}

export interface ImportPreview {
    importId: string;
    filename: string;
    status: (typeof imports.$inferSelect)["status"];
    createdAt: string;
    rowCount: number;
    needsReview: ReviewRow[];
    addToLibrary: RowPlan[];
    differences: RowPlan[];
    ownedOnly: RowPlan[];
    unchanged: RowPlan[];
    skipped: SkippedRow[];
    /** Every review row decided and every difference picked. */
    ready: boolean;
}

type ImportRowRecord = typeof importRows.$inferSelect;

function bookKey(row: { bookId: string | null; match: ImportCandidate | null }): string | null {
    if (row.bookId) return row.bookId;
    return row.match ? `hc:${row.match.hcBookId}` : null;
}

/** Works out what committing each matched row would change, given the library as it is now. */
export function planRows(rows: ImportRowRecord[]): RowPlan[] {
    const matched = rows.filter((row) => row.matchStatus === "matched" && row.parsed && !row.committedAt);
    const bookIds = [...new Set(matched.flatMap((row) => (row.bookId ? [row.bookId] : [])))];
    const entries = new Map(
        (bookIds.length
            ? db
                  .select()
                  .from(libraryEntries)
                  .where(and(inArray(libraryEntries.bookId, bookIds), isNull(libraryEntries.deletedAt)))
                  .all()
            : []
        ).map((entry) => [entry.bookId, entry]),
    );
    const entryIds = [...entries.values()].map((entry) => entry.id);
    const readDates = new Map<string, Set<string>>();
    for (const read of entryIds.length
        ? db
              .select({ entryId: reads.libraryEntryId, finishedAt: reads.finishedAt })
              .from(reads)
              .where(and(inArray(reads.libraryEntryId, entryIds), isNull(reads.deletedAt)))
              .all()
        : []) {
        if (!read.finishedAt) continue;
        const set = readDates.get(read.entryId) ?? new Set<string>();
        set.add(read.finishedAt.slice(0, 10));
        readDates.set(read.entryId, set);
    }
    const owned = ownedBookIds();

    const statusHandled = new Set<string>();
    const ownedHandled = new Set<string>();
    const plans: RowPlan[] = [];

    for (const row of matched) {
        const parsed = row.parsed as ParsedImportRow;
        const key = bookKey(row);
        const entry = row.bookId ? entries.get(row.bookId) : undefined;
        const plan: RowPlan = {
            rowId: row.id,
            parsed,
            match: row.match,
            bookId: row.bookId,
            addToLibrary: null,
            entryId: entry?.id ?? null,
            diffs: [],
            ownedAdd: false,
            newReads: [],
        };

        // Duplicate rows for one book: the first row with a status wins.
        if (parsed.status !== null && key && !statusHandled.has(key)) {
            statusHandled.add(key);
            if (!entry) {
                plan.addToLibrary = { status: parsed.status, rating: parsed.rating };
                plan.newReads = parsed.readDates;
            } else {
                const choices = row.choices ?? {};
                if (entry.status !== parsed.status) {
                    plan.diffs.push({
                        field: "status",
                        current: entry.status,
                        incoming: parsed.status,
                        choice: choices.status ?? null,
                    });
                }
                if (parsed.rating !== null && entry.rating !== parsed.rating) {
                    plan.diffs.push({
                        field: "rating",
                        current: entry.rating,
                        incoming: parsed.rating,
                        choice: choices.rating ?? null,
                    });
                }
                const known = readDates.get(entry.id) ?? new Set<string>();
                plan.newReads = parsed.readDates.filter((date) => !known.has(date.slice(0, 10)));
            }
        }

        // One copy per book on the Owned list, physical copies only.
        if (parsed.owned && parsed.physical && key && !ownedHandled.has(key)) {
            ownedHandled.add(key);
            plan.ownedAdd = !(row.bookId && owned.has(row.bookId));
        }

        plans.push(plan);
    }
    return plans;
}

export function getImportPreview(importId: string): ImportPreview | null {
    const record = db.select().from(imports).where(eq(imports.id, importId)).get();
    if (!record || record.deletedAt) return null;
    const rows = db
        .select()
        .from(importRows)
        .where(and(eq(importRows.importId, importId), isNull(importRows.deletedAt)))
        .orderBy(asc(importRows.createdAt))
        .all();

    const plans = record.status === "committed" ? [] : planRows(rows);
    const needsReview: ReviewRow[] = rows
        .filter((row) => row.matchStatus === "needs_review" && row.parsed)
        .map((row) => {
            const parsed = row.parsed as ParsedImportRow;
            const draft = row.draft ?? draftFromRow(parsed);
            return {
                rowId: row.id,
                parsed,
                candidates: row.candidates ?? [],
                note: row.note,
                openLibrary: {
                    status: row.openLibraryStatus,
                    found: row.openLibrary,
                    draft,
                    offered: row.openLibrary ? offeredFields(draft, row.openLibrary) : [],
                    prep: row.hardcoverPrep,
                },
            };
        });
    const skipped: SkippedRow[] = rows
        .filter((row) => row.matchStatus === "skipped")
        .map((row) => ({
            rowId: row.id,
            title: row.parsed?.title ?? row.raw.Title ?? "Untitled row",
            note: row.note ?? "Skipped",
        }));

    const preview: ImportPreview = {
        importId: record.id,
        filename: record.filename,
        status: record.status,
        createdAt: record.createdAt,
        rowCount: record.rowCount,
        needsReview,
        addToLibrary: plans.filter((plan) => plan.addToLibrary),
        differences: plans.filter((plan) => plan.diffs.length > 0),
        ownedOnly: plans.filter((plan) => !plan.addToLibrary && plan.diffs.length === 0 && plan.ownedAdd),
        // Read dates for books already in the library save quietly along with these.
        unchanged: plans.filter((plan) => !plan.addToLibrary && plan.diffs.length === 0 && !plan.ownedAdd),
        skipped,
        ready: false,
    };
    preview.ready =
        record.status === "review" &&
        needsReview.length === 0 &&
        preview.differences.every((plan) => plan.diffs.every((diff) => diff.choice !== null));
    return preview;
}
