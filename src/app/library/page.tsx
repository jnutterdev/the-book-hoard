import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { and, count, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { books, libraryEntries, listItems, type ReadingStatus } from "@/db/schema";
import { ownedBookIds, ownedListId } from "@/lib/list-membership";
import { parseStatus, STATUS_INFO, STATUS_ORDER } from "@/lib/reading-status";
import { DEFAULT_SORT, parseSort, publishedYear, SORT_OPTIONS, sortRows, type SortDir, type SortKey } from "@/lib/library-sort";

export const metadata: Metadata = { title: "Library" };

const visible = and(isNull(libraryEntries.deletedAt), isNull(libraryEntries.hiddenAt));
const hiddenOnly = and(isNull(libraryEntries.deletedAt), isNotNull(libraryEntries.hiddenAt));

type Filter = { kind: "all" } | { kind: "status"; status: ReadingStatus } | { kind: "hidden" } | { kind: "owned" };

interface LibraryRow {
    id: string;
    bookId: string;
    status: ReadingStatus | null;
    rating: number | null;
    owned: boolean;
    addedAt: string | null;
    published: string | null;
    title: string;
    subtitle: string | null;
    authors: string[];
    coverUrl: string | null;
}

function whereFor(filter: Exclude<Filter, { kind: "owned" }>) {
    if (filter.kind === "hidden") return hiddenOnly;
    if (filter.kind === "status") return and(visible, eq(libraryEntries.status, filter.status));
    return visible;
}

/** Everything on the Owned list, including books with no reading status (and so no library entry). */
function loadOwned(listId: string): LibraryRow[] {
    return db
        .select({
            id: listItems.id,
            bookId: books.id,
            status: libraryEntries.status,
            rating: libraryEntries.rating,
            hiddenAt: libraryEntries.hiddenAt,
            addedAt: libraryEntries.addedAt,
            listedAt: listItems.createdAt,
            published: books.firstPublished,
            title: books.title,
            subtitle: books.subtitle,
            authors: books.authors,
            coverUrl: books.coverUrl,
        })
        .from(listItems)
        .innerJoin(books, eq(books.id, listItems.bookId))
        .leftJoin(libraryEntries, and(eq(libraryEntries.bookId, books.id), isNull(libraryEntries.deletedAt)))
        .where(and(eq(listItems.listId, listId), isNull(listItems.deletedAt), isNull(books.deletedAt)))
        .all()
        .filter((row) => row.hiddenAt === null)
        .map((row) => ({
            id: row.id,
            bookId: row.bookId,
            status: row.status,
            rating: row.rating,
            owned: true,
            addedAt: row.addedAt ?? row.listedAt.slice(0, 10),
            published: row.published,
            title: row.title,
            subtitle: row.subtitle,
            authors: row.authors,
            coverUrl: row.coverUrl,
        }));
}

function loadLibrary(filter: Filter): LibraryRow[] {
    if (filter.kind === "owned") {
        const listId = ownedListId();
        return listId ? loadOwned(listId) : [];
    }
    return db
        .select({
            id: libraryEntries.id,
            bookId: books.id,
            status: libraryEntries.status,
            rating: libraryEntries.rating,
            owned: libraryEntries.owned,
            addedAt: libraryEntries.addedAt,
            published: books.firstPublished,
            title: books.title,
            subtitle: books.subtitle,
            authors: books.authors,
            coverUrl: books.coverUrl,
        })
        .from(libraryEntries)
        .innerJoin(books, eq(books.id, libraryEntries.bookId))
        .where(whereFor(filter))
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

interface Sort {
    key: SortKey;
    dir: SortDir;
}

function filterParams(filter: Filter): Record<string, string> {
    if (filter.kind === "hidden") return { hidden: "1" };
    if (filter.kind === "owned") return { owned: "1" };
    if (filter.kind === "status") return { status: String(filter.status) };
    return {};
}

/** A /library link that keeps the filter and sort, so switching one doesn't reset the other. */
function libraryHref(filter: Filter, sort: Sort): string {
    const params = new URLSearchParams(filterParams(filter));
    const isDefault = sort.key === DEFAULT_SORT.key && sort.dir === DEFAULT_SORT.dir;
    if (!isDefault) {
        params.set("sort", sort.key);
        params.set("dir", sort.dir);
    }
    const query = params.toString();
    return query ? `/library?${query}` : "/library";
}

function SortLinks({ filter, sort }: { filter: Filter; sort: Sort }) {
    return (
        <nav aria-label="Sort" className="flex flex-wrap items-center gap-1 text-sm">
            <span className="mr-1 text-brand-muted">Sort</span>
            {SORT_OPTIONS.map((option) => {
                const isActive = option.key === sort.key;
                // Clicking the active sort flips it; any other starts at its own default.
                const next: Sort = isActive
                    ? { key: option.key, dir: sort.dir === "asc" ? "desc" : "asc" }
                    : { key: option.key, dir: option.defaultDir };
                return (
                    <Link
                        key={option.key}
                        href={libraryHref(filter, next)}
                        aria-current={isActive ? "true" : undefined}
                        className={
                            isActive
                                ? "rounded-full bg-brand-line/60 px-2.5 py-0.5 font-bold text-brand-text"
                                : "rounded-full px-2.5 py-0.5 text-brand-muted hover:text-brand-text"
                        }
                    >
                        {option.label}
                        {isActive ? <span aria-hidden="true"> {sort.dir === "asc" ? "↑" : "↓"}</span> : null}
                    </Link>
                );
            })}
        </nav>
    );
}

function StatusTabs({
    active,
    sort,
    counts,
    hiddenCount,
    ownedCount,
}: {
    active: Filter;
    sort: Sort;
    counts: Map<ReadingStatus, number>;
    hiddenCount: number;
    ownedCount: number;
}) {
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    const tabs = [
        { key: "all", href: libraryHref({ kind: "all" }, sort), label: "All", n: total, isActive: active.kind === "all" },
        ...STATUS_ORDER.filter((status) => counts.has(status)).map((status) => ({
            key: String(status),
            href: libraryHref({ kind: "status", status }, sort),
            label: STATUS_INFO[status].label,
            n: counts.get(status) ?? 0,
            isActive: active.kind === "status" && active.status === status,
        })),
        ...(ownedCount > 0
            ? [{ key: "owned", href: libraryHref({ kind: "owned" }, sort), label: "Owned", n: ownedCount, isActive: active.kind === "owned" }]
            : []),
        ...(hiddenCount > 0
            ? [{ key: "hidden", href: libraryHref({ kind: "hidden" }, sort), label: "Hidden", n: hiddenCount, isActive: active.kind === "hidden" }]
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
        params.hidden === "1"
            ? { kind: "hidden" }
            : params.owned === "1"
              ? { kind: "owned" }
              : status !== null
                ? { kind: "status", status }
                : { kind: "all" };
    const counts = loadStatusCounts();
    const hiddenCount = loadHiddenCount();
    const sort = parseSort(
        typeof params.sort === "string" ? params.sort : undefined,
        typeof params.dir === "string" ? params.dir : undefined,
    );
    const rows = sortRows(loadLibrary(filter), sort.key, sort.dir);
    // Owned means "on Hardcover's Owned list" once that list has synced.
    const ownedIds = ownedListId() ? ownedBookIds() : null;
    const ownedCount = ownedIds?.size ?? 0;

    if (counts.size === 0 && hiddenCount === 0 && ownedCount === 0) {
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
            <StatusTabs active={filter} sort={sort} counts={counts} hiddenCount={hiddenCount} ownedCount={ownedCount} />
            <SortLinks filter={filter} sort={sort} />
            <div className="overflow-hidden rounded-2xl border border-brand-line">
                <table className="w-full table-fixed text-left text-sm">
                    <thead className="bg-brand-crust text-xs tracking-widest text-brand-muted uppercase">
                        <tr>
                            <th className="px-4 py-3 font-bold">Book</th>
                            <th className="w-36 px-4 py-3 font-bold">Status</th>
                            <th className="w-24 px-4 py-3 font-bold">Rating</th>
                            <th className="hidden w-20 px-4 py-3 font-bold sm:table-cell">Owned</th>
                            <th className="hidden w-28 px-4 py-3 font-bold md:table-cell">Published</th>
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
                                    {row.status === null ? (
                                        <span className="text-xs text-brand-faint">No status</span>
                                    ) : (
                                        <span
                                            className={`rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap ${STATUS_INFO[row.status].chipClass}`}
                                        >
                                            {STATUS_INFO[row.status].label}
                                        </span>
                                    )}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                    <Stars rating={row.rating} />
                                </td>
                                <td className="hidden px-4 py-3 text-brand-muted sm:table-cell">
                                    {(ownedIds ? ownedIds.has(row.bookId) : row.owned) ? "Yes" : ""}
                                </td>
                                <td className="hidden px-4 py-3 whitespace-nowrap text-brand-muted md:table-cell">
                                    {publishedYear(row.published) ?? ""}
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
