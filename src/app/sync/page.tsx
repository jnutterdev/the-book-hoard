import type { Metadata } from "next";
import Image from "next/image";
import { connection } from "next/server";
import { Suspense } from "react";
import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { syncRuns } from "@/db/schema";
import { summarizeStats } from "@/lib/sync/summary";

export const metadata: Metadata = { title: "Sync" };

const RUNS_SHOWN = 25;

function formatTime(iso: string): string {
    return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function duration(startedAt: string, finishedAt: string | null): string {
    if (!finishedAt) return "running";
    const seconds = (Date.parse(finishedAt) - Date.parse(startedAt)) / 1000;
    return seconds < 1 ? "<1s" : `${seconds.toFixed(1)}s`;
}

async function RunHistory() {
    await connection();
    const runs = db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(RUNS_SHOWN).all();

    if (runs.length === 0) {
        return <p className="text-brand-muted">No syncs yet. Hit &ldquo;Sync now&rdquo; up top to pull from Hardcover.</p>;
    }

    return (
        <ol className="flex flex-col gap-3">
            {runs.map((run) => {
                const failed = run.error !== null;
                const outcome = failed
                    ? run.error
                    : run.finishedAt
                      ? run.stats
                          ? summarizeStats(run.stats)
                          : "Finished"
                      : "Running…";
                return (
                    <li key={run.id} className="rounded-2xl border border-brand-line bg-brand-surface p-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <p className={failed ? "font-bold text-status-dnf" : "font-bold"}>{outcome}</p>
                            <p className="text-sm text-brand-muted">
                                {formatTime(run.startedAt)} · {run.kind} · {run.trigger} ·{" "}
                                {duration(run.startedAt, run.finishedAt)}
                            </p>
                        </div>
                        {run.errorDetail ? (
                            <details className="mt-2 text-sm">
                                <summary className="cursor-pointer text-brand-muted hover:text-brand-text">
                                    Details: {run.errorDetail.kind === "needs_confirmation" ? "paused" : "failed"} while{" "}
                                    {run.errorDetail.step}
                                </summary>
                                <pre className="mt-2 overflow-x-auto rounded-lg bg-brand-crust p-3 text-xs text-brand-soft">
                                    {JSON.stringify(run.errorDetail, null, 2)}
                                </pre>
                                <p className="mt-2 text-brand-faint">
                                    Full stack traces are in ~/.local/share/the-book-hoard/logs/ for that day.
                                </p>
                            </details>
                        ) : null}
                    </li>
                );
            })}
        </ol>
    );
}

export default function SyncPage() {
    return (
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
            <header className="flex items-center gap-4">
                <Image src="/art/robot-syncing.png" alt="" width={72} height={61} className="h-auto w-18" />
                <div>
                    <h1 className="text-3xl font-extrabold tracking-tight">Sync</h1>
                    <p className="text-brand-muted">The last {RUNS_SHOWN} runs between here and Hardcover.</p>
                </div>
            </header>
            <Suspense fallback={<p className="text-brand-muted">Loading runs…</p>}>
                <RunHistory />
            </Suspense>
        </main>
    );
}
