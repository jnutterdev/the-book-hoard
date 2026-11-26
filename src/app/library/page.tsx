import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { and, count, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { books, libraryEntries, type ReadingStatus } from "@/db/schema";
import { ownedBookIds, ownedListId } from "@/lib/list-membership";
import { parseStatus, STATUS_INFO, STATUS_ORDER } from "@/lib/reading-status";

export const metadata: Metadata = { title: "Library" };

const visible = and(isNull(libraryEntries.deletedAt), isNull(libraryEntries.hiddenAt));
const hiddenOnly = and(isNull(libraryEntries.deletedAt), isNotNull(libraryEntries.hiddenAt));

type Filter = { kind: "all" } | { kind: "status"; status: ReadingStatus } | { kind: "hidden" };

function whereFor(filter: Filter) {
    if (filter.kind === "hidden") return hiddenOnly;
    if (filter.kind === "status") return and(visible, eq(libraryEntries.status, filter.status));
    return visible;
}

function loadLibrary(filter: Filter) {
    return db
        .select({
            id: libraryEntries.id,
            bookId: books.id,
            status: libraryEntries.status,
            rating: libraryEntries.rating,
            owned: libraryEntries.owned,
            addedAt: libraryEntries.addedAt,
            title: books.title,
            subtitle: books.subtitle,
            authors: books.authors,
            coverUrl: books.coverUrl,
        })
        .from(libraryEntries)
        .innerJoin(books, eq(books.id, libraryEntries.bookId))
        .where(whereFor(filter))
        .orderBy(desc(libraryEntries.addedAt), books.title)
        .all();
}

function loadStatusCounts(): Map<ReadingStatus, number> {
    const rows = db
        .select({ status: libraryEntries.status, n: count() })
        .from(libraryEntries)
        .where(visible)
        .groupBy(libraryEntries.status)
        .all();
    return new Map(rows.map((row) => [row.status, row.n]));
}

function loadHiddenCount(): number {
    return db.select({ n: count() }).from(libraryEntries).where(hiddenOnly).get()?.n ?? 0;
}

function StatusTabs({
    active,
    counts,
    hiddenCount,
}: {
    active: Filter;
    counts: Map<ReadingStatus, number>;
    hiddenCount: number;
}) {
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    const tabs = [
        { key: "all", href: "/library", label: "All", n: total, isActive: active.kind === "all" },
        ...STATUS_ORDER.filter((status) => counts.has(status)).map((status) => ({
            key: String(status),
            href: `/library?status=${status}`,
            label: STATUS_INFO[status].label,
            n: counts.get(status) ?? 0,
            isActive: active.kind === "status" && active.status === status,
        })),
        ...(hiddenCount > 0
            ? [{ key: "hidden", href: "/library?hidden=1", label: "Hidden", n: hiddenCount, isActive: active.kind === "hidden" }]
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

function Stars({ rating }: { rating: number | null }) {
    if (rating === null) return <span className="text-brand-faint">—</span>;
    return (
        <span className="text-status-paused" title={`${rating} of 5`}>
            {"★".repeat(Math.floor(rating))}
            {rating % 1 >= 0.5 ? "½" : ""}
        </span>
    );
}

async function LibraryTable({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    await connection();
    const params = await searchParams;
    const status = parseStatus(typeof params.status === "string" ? params.status : undefined);
    const filter: Filter =
        params.hidden === "1" ? { kind: "hidden" } : status !== null ? { kind: "status", status } : { kind: "all" };
    const counts = loadStatusCounts();
    const hiddenCount = loadHiddenCount();
    const rows = loadLibrary(filter);
    // Owned means "on Hardcover's Owned list" once that list has synced.
    const ownedIds = ownedListId() ? ownedBookIds() : null;

    if (counts.size === 0 && hiddenCount === 0) {
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
            <StatusTabs active={filter} counts={counts} hiddenCount={hiddenCount} />
            <div className="overflow-hidden rounded-2xl border border-brand-line">
                <table className="w-full table-fixed text-left text-sm">
                    <thead className="bg-brand-crust text-xs tracking-widest text-brand-muted uppercase">
                        <tr>
                            <th className="px-4 py-3 font-bold">Book</th>
                            <th className="w-36 px-4 py-3 font-bold">Status</th>
                            <th className="w-24 px-4 py-3 font-bold">Rating</th>
                            <th className="hidden w-20 px-4 py-3 font-bold sm:table-cell">Owned</th>
                            <th className="hidden w-28 px-4 py-3 font-bold md:table-cell">Added</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-brand-line bg-brand-surface">
                        {rows.map((row) => (
                            <tr key={row.id}>
                                <td className="px-4 py-3">
                                    <Link href={`/books/${row.bookId}`} className="group flex items-center gap-3">
                                        {row.coverUrl ? (
                                            <Image
                                                src={row.coverUrl}
                                                alt=""
                                                width={40}
                                                height={60}
                                                className="h-15 w-10 shrink-0 rounded object-cover"
                                            />
                                        ) : (
                                            <div className="h-15 w-10 shrink-0 rounded bg-brand-line" />
                                        )}
                                        <div className="min-w-0">
                                            <p className="truncate font-bold group-hover:text-brand-accent">{row.title}</p>
                                            <p className="truncate text-brand-muted">
                                                {row.authors.join(", ") || "Unknown author"}
                                            </p>
                                        </div>
                                    </Link>
                                </td>
                                <td className="px-4 py-3">
                                    <span
                                        className={`rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap ${STATUS_INFO[row.status].chipClass}`}
                                    >
                                        {STATUS_INFO[row.status].label}
                                    </span>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                    <Stars rating={row.rating} />
                                </td>
                                <td className="hidden px-4 py-3 text-brand-muted sm:table-cell">
                                    {(ownedIds ? ownedIds.has(row.bookId) : row.owned) ? "Yes" : ""}
                                </td>
                                <td className="hidden px-4 py-3 whitespace-nowrap text-brand-muted md:table-cell">
                                    {row.addedAt ?? ""}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
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
