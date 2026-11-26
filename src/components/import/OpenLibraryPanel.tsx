"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import {
    addBookToHardcover,
    checkWithHardcover,
    keepBookHereOnly,
    lookUpOnOpenLibrary,
    skipOpenLibraryResult,
    applyAllOpenLibraryFields,
    applyOpenLibraryField,
    type ImportActionResult,
} from "@/app/actions/import";
import type { BookDetailField, BookDetails, HardcoverPrep, OpenLibraryStatus } from "@/db/schema";

const PRIMARY =
    "rounded-full bg-brand-accent px-3 py-1 text-sm font-bold text-brand-crust transition hover:bg-brand-accent-alt disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY =
    "rounded-full border border-brand-line-strong px-3 py-1 text-sm font-bold text-brand-soft transition hover:bg-brand-line/40 disabled:cursor-not-allowed disabled:opacity-50";
const SMALL =
    "rounded-full border border-brand-line-strong px-2 py-0.5 text-xs font-bold text-brand-soft hover:bg-brand-line/40 disabled:opacity-50";

const FIELDS: { field: BookDetailField; label: string }[] = [
    { field: "title", label: "Title" },
    { field: "subtitle", label: "Subtitle" },
    { field: "authors", label: "Authors" },
    { field: "publisher", label: "Publisher" },
    { field: "publishDate", label: "Published" },
    { field: "pages", label: "Pages" },
    { field: "isbn13", label: "ISBN-13" },
    { field: "isbn10", label: "ISBN-10" },
    { field: "coverUrl", label: "Cover" },
];

const COVER_HOST = "https://covers.openlibrary.org/";

export interface OpenLibraryState {
    status: OpenLibraryStatus | null;
    found: BookDetails | null;
    draft: BookDetails;
    offered: BookDetailField[];
    prep: HardcoverPrep | null;
}

function show(details: BookDetails, field: BookDetailField): string | null {
    const value = details[field];
    if (value === null || (Array.isArray(value) && value.length === 0)) return null;
    if (field === "coverUrl") return "Cover image";
    return Array.isArray(value) ? value.join(", ") : String(value);
}

function useAction() {
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const run = (act: () => Promise<ImportActionResult>) =>
        startTransition(async () => {
            const result = await act();
            setError(result.ok ? null : result.error);
        });
    return { pending, error, setError, run, startTransition };
}

function AddToHardcover({ rowId, title, prep }: { rowId: string; title: string; prep: HardcoverPrep }) {
    const { pending, error, setError, startTransition } = useAction();
    const [confirming, setConfirming] = useState(false);
    const blocked = prep.authors.some((author) => author.id === null);

    if (!confirming) {
        return (
            <div className="flex flex-col gap-1">
                <button type="button" disabled={blocked} className={PRIMARY} onClick={() => setConfirming(true)}>
                    Add to Hardcover…
                </button>
                {error ? <p className="text-xs text-status-dnf">{error}</p> : null}
            </div>
        );
    }
    return (
        <div className="flex flex-col gap-2 rounded-xl border-2 border-brand-accent bg-brand-accent/10 p-3">
            <p className="text-sm">
                This creates a public book record for <span className="font-bold">{title}</span> in Hardcover&rsquo;s
                catalog that other readers will see. Add it?
            </p>
            <div className="flex gap-2">
                <button
                    type="button"
                    disabled={pending}
                    className={PRIMARY}
                    onClick={() =>
                        startTransition(async () => {
                            const result = await addBookToHardcover(rowId);
                            if (!result.ok) {
                                setError(result.error);
                                setConfirming(false);
                            }
                        })
                    }
                >
                    {pending ? "Adding…" : "Yes, add it"}
                </button>
                <button type="button" disabled={pending} className={SECONDARY} onClick={() => setConfirming(false)}>
                    Cancel
                </button>
            </div>
        </div>
    );
}

/** Open Library's details for a row Hardcover couldn't match, and the path to adding it there. */
export function OpenLibraryPanel({ rowId, state }: { rowId: string; state: OpenLibraryState }) {
    const { pending, error, run } = useAction();
    const { status, found, draft, offered, prep } = state;

    if (status !== "found" || !found) {
        const text =
            status === "not_found"
                ? "Open Library doesn't have it either."
                : status === "skipped"
                  ? "You skipped Open Library's details for this one."
                  : "Not checked on Open Library yet.";
        return (
            <div className="flex flex-wrap items-center gap-2 text-sm text-brand-muted">
                <span>{text}</span>
                <button type="button" disabled={pending} className={SMALL} onClick={() => run(() => lookUpOnOpenLibrary(rowId))}>
                    {pending ? "Looking…" : status ? "Look again" : "Look up on Open Library"}
                </button>
                <button type="button" disabled={pending} className={SMALL} onClick={() => run(() => keepBookHereOnly(rowId))}>
                    Keep here only (from your file)
                </button>
                {error ? <span className="text-xs text-status-dnf">{error}</span> : null}
            </div>
        );
    }

    const rows = FIELDS.filter(({ field }) => show(draft, field) !== null || show(found, field) !== null);
    const cover = found.coverUrl?.startsWith(COVER_HOST) ? found.coverUrl : null;

    return (
        <div className="flex flex-col gap-3 rounded-xl border border-brand-line bg-brand-crust/40 p-3">
            <div className="flex items-start gap-3">
                {cover ? (
                    <Image src={cover} alt="" width={48} height={72} className="h-18 w-12 shrink-0 rounded object-cover" />
                ) : null}
                <div className="min-w-0">
                    <p className="text-sm font-bold">Open Library has this book</p>
                    <p className="text-xs text-brand-muted">
                        It only fills blanks; anything from your file stays as is.
                    </p>
                </div>
            </div>

            <table className="w-full table-fixed text-left text-sm">
                <thead className="text-xs text-brand-muted">
                    <tr>
                        <th className="w-24 py-1 font-bold">Field</th>
                        <th className="py-1 font-bold">Will be sent</th>
                        <th className="py-1 font-bold">Open Library</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(({ field, label }) => {
                        const mine = show(draft, field);
                        const theirs = show(found, field);
                        const canUse = offered.includes(field);
                        return (
                            <tr key={field} className="border-t border-brand-line align-top">
                                <td className="py-1.5 text-brand-muted">{label}</td>
                                <td className="py-1.5 break-words">{mine ?? <span className="text-brand-faint">Blank</span>}</td>
                                <td className="py-1.5 break-words">
                                    {canUse ? (
                                        <span className="flex flex-wrap items-center gap-2">
                                            <span className="text-brand-soft">{theirs}</span>
                                            <button
                                                type="button"
                                                disabled={pending}
                                                className={SMALL}
                                                onClick={() => run(() => applyOpenLibraryField(rowId, field))}
                                            >
                                                Use
                                            </button>
                                        </span>
                                    ) : (
                                        <span className="text-brand-faint">{theirs ?? "—"}</span>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            <div className="flex flex-wrap items-center gap-2">
                {offered.length > 0 ? (
                    <button type="button" disabled={pending} className={SECONDARY} onClick={() => run(() => applyAllOpenLibraryFields(rowId))}>
                        Use all ({offered.length})
                    </button>
                ) : null}
                <button type="button" disabled={pending} className={SECONDARY} onClick={() => run(() => skipOpenLibraryResult(rowId))}>
                    Skip Open Library
                </button>
                {error ? <span className="text-xs text-status-dnf">{error}</span> : null}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-brand-line pt-3">
                <button type="button" disabled={pending} className={PRIMARY} onClick={() => run(() => keepBookHereOnly(rowId))}>
                    Keep here only
                </button>
                <span className="text-xs text-brand-muted">
                    Adds it to the hoard with these details. It goes on your Owned list here, never to Hardcover.
                </span>
            </div>

            <details className="border-t border-brand-line pt-3">
                <summary className="cursor-pointer text-sm text-brand-muted hover:text-brand-text">
                    Add to Hardcover instead (Hardcover supporters and librarians only)
                </summary>
                <div className="mt-2 flex flex-col gap-2">
                {prep ? (
                    <>
                        <ul className="text-sm text-brand-soft">
                            {prep.authors.map((author) => (
                                <li key={author.name}>
                                    Author {author.name}:{" "}
                                    {author.id !== null ? (
                                        <>
                                            {author.hcName} on Hardcover ({author.books} books)
                                        </>
                                    ) : (
                                        <span className="text-status-dnf">not on Hardcover, so this book can&rsquo;t go up yet</span>
                                    )}
                                </li>
                            ))}
                            <li>
                                Publisher:{" "}
                                {prep.publisher
                                    ? `${prep.publisher.name} on Hardcover`
                                    : draft.publisher
                                      ? `${draft.publisher} isn't on Hardcover, so it's left off`
                                      : "none"}
                            </li>
                            <li>Cover: stays here only for now</li>
                        </ul>
                        <div className="flex flex-wrap items-start gap-2">
                            <AddToHardcover rowId={rowId} title={draft.title ?? "this book"} prep={prep} />
                            <button type="button" disabled={pending} className={SECONDARY} onClick={() => run(() => checkWithHardcover(rowId))}>
                                Check again
                            </button>
                        </div>
                    </>
                ) : (
                    <div className="flex flex-wrap items-center gap-2">
                        <button type="button" disabled={pending} className={SECONDARY} onClick={() => run(() => checkWithHardcover(rowId))}>
                            {pending ? "Checking…" : "Check with Hardcover"}
                        </button>
                        <span className="text-xs text-brand-muted">
                            Finds the author and publisher on Hardcover. Doesn&rsquo;t change anything.
                        </span>
                    </div>
                )}
                </div>
            </details>
        </div>
    );
}
