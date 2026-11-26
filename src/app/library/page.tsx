import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { libraryEntries, type ReadingStatus } from "@/db/schema";
import { BookTable } from "@/components/library/BookTable";
import { SortLinks } from "@/components/library/SortLinks";
import { hiddenEntries, loadEntries, loadEverything, loadListBooks, visibleEntries, type LibraryRow } from "@/lib/library-rows";
import { parseSort, sortHref, sortRows, type SortDir, type SortKey } from "@/lib/library-sort";
import { ownedBookIds, ownedListId } from "@/lib/list-membership";
import { parseStatus, STATUS_INFO, STATUS_ORDER } from "@/lib/reading-status";

export const metadata: Metadata = { title: "Library" };

type Filter = { kind: "all" } | { kind: "status"; status: ReadingStatus } | { kind: "hidden" } | { kind: "owned" };

interface Sort {
    key: SortKey;
    dir: SortDir;
}

function loadLibrary(filter: Filter): LibraryRow[] {
    switch (filter.kind) {
        case "all":
            return loadEverything();
        case "owned": {
            const listId = ownedListId();
            return listId ? loadListBooks(listId) : [];
        }
        case "hidden":
            return loadEntries(hiddenEntries);
        case "status":
            return loadEntries(and(visibleEntries, eq(libraryEntries.status, filter.status)));
    }
}

function loadStatusCounts(): Map<ReadingStatus, number> {
    const rows = db
        .select({ status: libraryEntries.status, n: count() })
        .from(libraryEntries)
        .where(visibleEntries)
        .groupBy(libraryEntries.status)
        .all();
    return new Map(rows.map((row) => [row.status, row.n]));
}

function loadHiddenCount(): number {
    return db.select({ n: count() }).from(libraryEntries).where(hiddenEntries).get()?.n ?? 0;
}

function filterParams(filter: Filter): Record<string, string> {
    if (filter.kind === "hidden") return { hidden: "1" };
    if (filter.kind === "owned") return { owned: "1" };
    if (filter.kind === "status") return { status: String(filter.status) };
    return {};
}

function StatusTabs({
    active,
    sort,
    allCount,
    counts,
    hiddenCount,
    ownedCount,
}: {
    active: Filter;
    sort: Sort;
    allCount: number;
    counts: Map<ReadingStatus, number>;
    hiddenCount: number;
    ownedCount: number;
}) {
    // Switching tabs keeps the sort.
    const href = (filter: Filter) => sortHref("/library", filterParams(filter), sort);
    const tabs = [
        { key: "all", href: href({ kind: "all" }), label: "All", n: allCount, isActive: active.kind === "all" },
        ...STATUS_ORDER.filter((status) => counts.has(status)).map((status) => ({
            key: String(status),
            href: href({ kind: "status", status }),
            label: STATUS_INFO[status].label,
            n: counts.get(status) ?? 0,
            isActive: active.kind === "status" && active.status === status,
        })),
        ...(ownedCount > 0
            ? [{ key: "owned", href: href({ kind: "owned" }), label: "Owned", n: ownedCount, isActive: active.kind === "owned" }]
            : []),
        ...(hiddenCount > 0
            ? [{ key: "hidden", href: href({ kind: "hidden" }), label: "Hidden", n: hiddenCount, isActive: active.kind === "hidden" }]
            : []),
    ];

    return (
        <nav className="flex flex-wrap gap-2">
            {tabs.map((tab) => (
                <Link
                    key={tab.key}
                    href={tab.href}
                    className={
                        tab.isActive
                            ? "rounded-full bg-brand-accent px-3 py-1 text-sm font-bold text-brand-crust"
                            : "rounded-full border border-brand-line px-3 py-1 text-sm text-brand-muted hover:text-brand-text"
                    }
                >
                    {tab.label} <span className="opacity-70">{tab.n}</span>
                </Link>
            ))}
        </nav>
    );
}

async function LibraryTable({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    await connection();
    const params = await searchParams;
    const status = parseStatus(typeof params.status === "string" ? params.status : undefined);
    const filter: Filter =
        params.hidden === "1"
            ? { kind: "hidden" }
            : params.owned === "1"
              ? { kind: "owned" }
              : status !== null
                ? { kind: "status", status }
                : { kind: "all" };
    const sort = parseSort(
        typeof params.sort === "string" ? params.sort : undefined,
        typeof params.dir === "string" ? params.dir : undefined,
    );
    const counts = loadStatusCounts();
    const hiddenCount = loadHiddenCount();
    const loaded = loadLibrary(filter);
    const allCount = filter.kind === "all" ? loaded.length : loadEverything().length;
    const rows = sortRows(loaded, sort.key, sort.dir);
    // Owned means "on Hardcover's Owned list" once that list has synced.
    const ownedIds = ownedListId() ? ownedBookIds() : null;
    const ownedCount = ownedIds?.size ?? 0;

    if (allCount === 0 && hiddenCount === 0) {
        return (
            <div className="flex flex-col items-center gap-4 rounded-2xl border border-brand-line bg-brand-surface p-10 text-center">
                <Image
                    src="/art/dragon-napping-on-emptyshelf.png"
                    alt="a chibi dragon napping on an empty shelf"
                    width={160}
                    height={159}
                    className="h-auto w-40"
                />
                <p className="text-lg font-bold">The hoard is empty</p>
                <p className="text-brand-muted">Hit &ldquo;Sync now&rdquo; to pull your library from Hardcover.</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <StatusTabs
                active={filter}
                sort={sort}
                allCount={allCount}
                counts={counts}
                hiddenCount={hiddenCount}
                ownedCount={ownedCount}
            />
            <SortLinks path="/library" params={filterParams(filter)} sort={sort} />
            <BookTable rows={rows} ownedIds={ownedIds} />
        </div>
    );
}

export default function LibraryPage(props: PageProps<"/library">) {
    return (
        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
            <h1 className="text-3xl font-extrabold tracking-tight">Library</h1>
            <Suspense fallback={<p className="text-brand-muted">Counting the hoard…</p>}>
                <LibraryTable searchParams={props.searchParams} />
            </Suspense>
        </main>
    );
}
