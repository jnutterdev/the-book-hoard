"use server";

import { refresh } from "next/cache";
import type { BookDetailField, ImportChoice } from "@/db/schema";
import { HardcoverError } from "@/lib/hardcover/client";
import type { DiffField } from "@/lib/import/plan";
import {
    acceptAllFields,
    acceptField,
    addToHardcover,
    DETAIL_FIELDS,
    keepHereOnly,
    lookUpOpenLibrary,
    prepareForHardcover,
    skipOpenLibrary,
} from "@/lib/import/rescue";
import { OpenLibraryError } from "@/lib/openlibrary/client";
import {
    commitImport,
    createStoryGraphImport,
    discardImport,
    pickCandidate,
    searchAgain,
    setAllChoices,
    setChoice,
    skipRow,
    unmatchRow,
    type CommitSummary,
} from "@/lib/import/run";

export type ImportActionResult = { ok: true } | { ok: false; error: string };

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function message(error: unknown): string {
    if (error instanceof HardcoverError) {
        if (error.kind === "rate_limited") return "Hardcover is rate limiting us. Try again in a minute.";
        if (error.kind === "network") return "Couldn't reach Hardcover.";
        if (error.kind === "unauthorized" || error.kind === "missing_token") return "Hardcover rejected the API key.";
    }
    if (error instanceof OpenLibraryError) return error.message;
    return error instanceof Error ? error.message : "Something went wrong";
}

async function attempt(work: () => void | Promise<void>): Promise<ImportActionResult> {
    try {
        await work();
        refresh();
        return { ok: true };
    } catch (error) {
        return { ok: false, error: message(error) };
    }
}

export async function uploadStoryGraph(
    formData: FormData,
): Promise<{ ok: true; importId: string } | { ok: false; error: string }> {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Pick a StoryGraph CSV export first" };
    if (file.size > MAX_FILE_BYTES) return { ok: false, error: "That file is bigger than 5 MB" };
    try {
        const importId = await createStoryGraphImport(file.name, await file.text());
        refresh();
        return { ok: true, importId };
    } catch (error) {
        return { ok: false, error: message(error) };
    }
}

export async function pickMatch(rowId: string, hcBookId: number): Promise<ImportActionResult> {
    return attempt(() => pickCandidate(rowId, hcBookId));
}

export async function skipImportRow(rowId: string): Promise<ImportActionResult> {
    return attempt(() => skipRow(rowId));
}

export async function sendBackToReview(rowId: string): Promise<ImportActionResult> {
    return attempt(() => unmatchRow(rowId));
}

export async function searchHardcoverAgain(rowId: string, query: string): Promise<ImportActionResult> {
    return attempt(() => searchAgain(rowId, query));
}

export async function chooseSide(rowId: string, field: DiffField, choice: ImportChoice): Promise<ImportActionResult> {
    if (field !== "status" && field !== "rating") return { ok: false, error: "Unknown field" };
    if (choice !== "import" && choice !== "current") return { ok: false, error: "Unknown choice" };
    return attempt(() => setChoice(rowId, field, choice));
}

export async function chooseAll(importId: string, choice: ImportChoice): Promise<ImportActionResult> {
    if (choice !== "import" && choice !== "current") return { ok: false, error: "Unknown choice" };
    return attempt(() => setAllChoices(importId, choice));
}

export async function discardStoryGraphImport(importId: string): Promise<ImportActionResult> {
    return attempt(() => discardImport(importId));
}

export async function commitStoryGraphImport(
    importId: string,
): Promise<{ ok: true; summary: CommitSummary } | { ok: false; error: string }> {
    try {
        const summary = await commitImport(importId);
        refresh();
        return { ok: true, summary };
    } catch (error) {
        return { ok: false, error: message(error) };
    }
}

export async function lookUpOnOpenLibrary(rowId: string): Promise<ImportActionResult> {
    return attempt(() => lookUpOpenLibrary(rowId));
}

export async function applyOpenLibraryField(rowId: string, field: BookDetailField): Promise<ImportActionResult> {
    if (!DETAIL_FIELDS.includes(field)) return { ok: false, error: "Unknown field" };
    return attempt(() => acceptField(rowId, field));
}

export async function applyAllOpenLibraryFields(rowId: string): Promise<ImportActionResult> {
    return attempt(() => acceptAllFields(rowId));
}

export async function skipOpenLibraryResult(rowId: string): Promise<ImportActionResult> {
    return attempt(() => skipOpenLibrary(rowId));
}

/** Finds the Hardcover authors and publisher a book would go up with. Read-only. */
export async function checkWithHardcover(rowId: string): Promise<ImportActionResult> {
    return attempt(async () => {
        await prepareForHardcover(rowId);
    });
}

/** Creates one book in Hardcover's public catalog. Only ever called from its own confirm click. */
export async function addBookToHardcover(
    rowId: string,
): Promise<{ ok: true; created: boolean; title: string } | { ok: false; error: string }> {
    try {
        const result = await addToHardcover(rowId);
        refresh();
        return { ok: true, ...result };
    } catch (error) {
        return { ok: false, error: message(error) };
    }
}

/** Makes the book in this app only. Nothing goes to Hardcover. */
export async function keepBookHereOnly(rowId: string): Promise<ImportActionResult> {
    return attempt(() => keepHereOnly(rowId));
}
