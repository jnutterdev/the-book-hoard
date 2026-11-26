"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import {
    chooseAll,
    chooseSide,
    commitStoryGraphImport,
    discardStoryGraphImport,
    pickMatch,
    searchHardcoverAgain,
    sendBackToReview,
    skipImportRow,
    type ImportActionResult,
} from "@/app/actions/import";
import type { ImportChoice } from "@/db/schema";
import type { DiffField } from "@/lib/import/plan";

const PRIMARY =
    "rounded-full bg-brand-accent px-3 py-1 text-sm font-bold text-brand-crust transition hover:bg-brand-accent-alt disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY =
    "rounded-full border border-brand-line-strong px-3 py-1 text-sm font-bold text-brand-soft transition hover:bg-brand-line/40 disabled:cursor-not-allowed disabled:opacity-50";
const LINK = "text-xs text-brand-muted hover:text-brand-text hover:underline disabled:opacity-50";

function useAction() {
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const run = (act: () => Promise<ImportActionResult>) =>
        startTransition(async () => {
            const result = await act();
            setError(result.ok ? null : result.error);
        });
    return { pending, error, run };
}

function ErrorText({ error }: { error: string | null }) {
    return error ? <p className="text-xs text-status-dnf">{error}</p> : null;
}

export function PickButton({ rowId, hcBookId }: { rowId: string; hcBookId: number }) {
    const { pending, error, run } = useAction();
    return (
        <div className="flex flex-col items-end gap-1">
            <button type="button" disabled={pending} className={PRIMARY} onClick={() => run(() => pickMatch(rowId, hcBookId))}>
                This one
            </button>
            <ErrorText error={error} />
        </div>
    );
}

export function ReviewTools({ rowId, defaultQuery }: { rowId: string; defaultQuery: string }) {
    const { pending, error, run } = useAction();
    const [query, setQuery] = useState(defaultQuery);
    return (
        <div className="flex flex-col gap-2">
            <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(event) => {
                    event.preventDefault();
                    run(() => searchHardcoverAgain(rowId, query));
                }}
            >
                <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    aria-label="Search Hardcover"
                    className="min-w-0 flex-1 rounded-full border border-brand-line-strong bg-brand-crust px-3 py-1 text-sm"
                />
                <button type="submit" disabled={pending} className={SECONDARY}>
                    {pending ? "Searching…" : "Search again"}
                </button>
                <button type="button" disabled={pending} className={SECONDARY} onClick={() => run(() => skipImportRow(rowId))}>
                    Skip
                </button>
            </form>
            <ErrorText error={error} />
        </div>
    );
}

export function NotThisBook({ rowId }: { rowId: string }) {
    const { pending, error, run } = useAction();
    return (
        <span className="flex flex-col items-end">
            <button type="button" disabled={pending} className={LINK} onClick={() => run(() => sendBackToReview(rowId))}>
                Wrong book?
            </button>
            <ErrorText error={error} />
        </span>
    );
}

export function SidePicker({
    rowId,
    field,
    choice,
    importLabel,
    currentLabel,
}: {
    rowId: string;
    field: DiffField;
    choice: ImportChoice | null;
    importLabel: ReactNode;
    currentLabel: ReactNode;
}) {
    const { pending, error, run } = useAction();
    const option = (value: ImportChoice, label: ReactNode, source: string) => (
        <button
            type="button"
            disabled={pending}
            aria-pressed={choice === value}
            onClick={() => run(() => chooseSide(rowId, field, value))}
            className={
                choice === value
                    ? "rounded-xl border-2 border-brand-accent bg-brand-accent/10 px-3 py-1 text-left text-sm"
                    : "rounded-xl border-2 border-brand-line px-3 py-1 text-left text-sm hover:border-brand-line-strong"
            }
        >
            <span className="block text-xs text-brand-muted">{source}</span>
            {label}
        </button>
    );
    return (
        <div className="flex flex-col gap-1">
            <div className="flex flex-wrap gap-2">
                {option("import", importLabel, "StoryGraph")}
                {option("current", currentLabel, "Keep current")}
            </div>
            <ErrorText error={error} />
        </div>
    );
}

export function ChooseAll({ importId }: { importId: string }) {
    const { pending, error, run } = useAction();
    return (
        <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={pending} className={SECONDARY} onClick={() => run(() => chooseAll(importId, "import"))}>
                StoryGraph for all
            </button>
            <button type="button" disabled={pending} className={SECONDARY} onClick={() => run(() => chooseAll(importId, "current"))}>
                Keep current for all
            </button>
            <ErrorText error={error} />
        </div>
    );
}

export function CommitBar({ importId, ready, blocker }: { importId: string; ready: boolean; blocker: string | null }) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [message, setMessage] = useState<string | null>(null);

    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    disabled={!ready || pending}
                    className={PRIMARY}
                    onClick={() =>
                        startTransition(async () => {
                            const result = await commitStoryGraphImport(importId);
                            if (!result.ok) {
                                setMessage(result.error);
                                return;
                            }
                            const { addedToLibrary, updated, ownedAdded, readsSaved } = result.summary;
                            setMessage(
                                `Imported: ${addedToLibrary} added to the library, ${updated} updated, ${ownedAdded} added to Owned, ${readsSaved} read dates saved. They go to Hardcover on the next sync.`,
                            );
                        })
                    }
                >
                    {pending ? "Importing…" : "Import"}
                </button>
                <button
                    type="button"
                    disabled={pending}
                    className={SECONDARY}
                    onClick={() =>
                        startTransition(async () => {
                            const result = await discardStoryGraphImport(importId);
                            if (result.ok) router.push("/import");
                            else setMessage(result.error);
                        })
                    }
                >
                    Discard
                </button>
                {blocker ? <span className="text-sm text-brand-muted">{blocker}</span> : null}
            </div>
            {message ? <p className="text-sm text-brand-soft">{message}</p> : null}
        </div>
    );
}
