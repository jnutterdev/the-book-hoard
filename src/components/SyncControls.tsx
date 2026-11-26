"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { autoSync, syncNow, type SyncResult } from "@/app/actions/sync";

interface Props {
    /** A sync was already running when the page rendered (for example, started in another tab). */
    running: boolean;
    autoSyncDue: boolean;
    lastMessage: string | null;
    lastFailed: boolean;
    /** Set when the last run stopped at the deletion guard. */
    lastWouldRemove: WouldRemove | null;
}

export type WouldRemove = NonNullable<Extract<SyncResult, { state: "error" }>["wouldRemove"]>;

function describeRemovals(wouldRemove: WouldRemove): string {
    const parts = [
        wouldRemove.books > 0 ? `${wouldRemove.books} books` : null,
        wouldRemove.lists > 0 ? `${wouldRemove.lists} lists` : null,
        wouldRemove.listItems > 0 ? `${wouldRemove.listItems} list entries` : null,
    ].filter((part): part is string => part !== null);
    return parts.join(", ");
}

export function SyncControls({ running, autoSyncDue, lastMessage, lastFailed, lastWouldRemove }: Props) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [result, setResult] = useState<SyncResult | null>(null);
    const autoStarted = useRef(false);

    useEffect(() => {
        if (!autoSyncDue || autoStarted.current) return;
        autoStarted.current = true;
        startTransition(async () => {
            const outcome = await autoSync();
            if (outcome.state !== "skipped") setResult(outcome);
        });
    }, [autoSyncDue]);

    // Another tab's sync holds the lock; check back until it's done.
    useEffect(() => {
        if (!running || pending) return;
        const timer = setInterval(() => router.refresh(), 3000);
        return () => clearInterval(timer);
    }, [running, pending, router]);

    const run = (confirmDeletions = false) =>
        startTransition(async () => setResult(await syncNow({ confirmDeletions })));

    const busy = pending || running;
    let message = lastMessage;
    let failed = lastFailed;
    if (result?.state === "ok") [message, failed] = [result.summary, false];
    if (result?.state === "error") [message, failed] = [result.message, true];
    if (result?.state === "busy") [message, failed] = ["A sync is already running", false];

    const wouldRemove = result ? (result.state === "error" ? result.wouldRemove : undefined) : lastWouldRemove;

    return (
        <div className="flex flex-col items-end gap-1 text-sm">
            <div className="flex items-center gap-3">
                {busy ? (
                    <span className="flex items-center gap-2 text-brand-muted" role="status">
                        <span className="size-3.5 animate-spin rounded-full border-2 border-brand-line-strong border-t-brand-accent" />
                        Syncing…
                    </span>
                ) : message ? (
                    <Link
                        href="/sync"
                        className={failed ? "text-status-dnf hover:underline" : "text-brand-muted hover:underline"}
                    >
                        {message}
                    </Link>
                ) : null}
                <button
                    type="button"
                    onClick={() => run()}
                    disabled={busy}
                    className="rounded-full bg-brand-accent px-4 py-1.5 font-bold text-brand-crust transition hover:bg-brand-accent-alt disabled:cursor-not-allowed disabled:opacity-50"
                >
                    Sync now
                </button>
            </div>
            {wouldRemove && !busy ? (
                <div className="flex items-center gap-3 text-brand-soft">
                    <span>Hardcover no longer has {describeRemovals(wouldRemove)}.</span>
                    <button
                        type="button"
                        onClick={() => run(true)}
                        className="rounded-full border border-status-dnf px-3 py-1 font-bold text-status-dnf hover:bg-status-dnf/10"
                    >
                        Remove them here too
                    </button>
                </div>
            ) : null}
        </div>
    );
}
