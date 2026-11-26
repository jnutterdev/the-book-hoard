import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { and, asc, desc, eq, isNull, ne, or } from "drizzle-orm";
import { db } from "@/db/client";
import { books, editions, externalIds, libraryEntries, listItems, lists, OWNED_LIST_SLUG, reads } from "@/db/schema";
import { ownedListId } from "@/lib/list-membership";
import { EntryControls, type StatusOption } from "@/components/book/EntryControls";
import { ListMembership } from "@/components/book/ListMembership";
import { hasPendingChanges } from "@/lib/outbox";
import { STATUS_INFO, STATUS_ORDER } from "@/lib/reading-status";

export const metadata: Metadata = { title: "Book" };

const STATUS_OPTIONS: StatusOption[] = STATUS_ORDER.map((value) => ({ value, ...STATUS_INFO[value] }));

function loadBook(bookId: string) {
    const book = db
        .select()
        .from(books)
        .where(and(eq(books.id, bookId), isNull(books.deletedAt)))
        .get();
    if (!book) return null;

    const entry = db
        .select()
        .from(libraryEntries)
        .where(and(eq(libraryEntries.bookId, bookId), isNull(libraryEntries.deletedAt)))
        .get();
    const edition = entry?.editionId
        ? db.select().from(editions).where(eq(editions.id, entry.editionId)).get()
        : undefined;
    const readHistory = entry
        ? db
              .select()
              .from(reads)
              .where(and(eq(reads.libraryEntryId, entry.id), isNull(reads.deletedAt)))
              .orderBy(desc(reads.finishedAt), desc(reads.startedAt))
              .all()
        : [];

    // The Owned list is driven by the "I own a copy" switch, so it isn't offered here.
    const allLists = db
        .select({ id: lists.id, name: lists.name })
        .from(lists)
        .where(and(isNull(lists.deletedAt), or(isNull(lists.slug), ne(lists.slug, OWNED_LIST_SLUG))))
        .orderBy(asc(lists.name))
        .all();
    const memberships = db
        .select({ id: listItems.id, listId: listItems.listId })
        .from(listItems)
        .where(and(eq(listItems.bookId, bookId), isNull(listItems.deletedAt)))
        .all();
    const onLists = new Set(memberships.map((item) => item.listId));
    const ownedId = ownedListId();
    const owned = ownedId ? onLists.has(ownedId) : (entry?.owned ?? false);

    const hardcoverUrl = db
        .select({ url: externalIds.url })
        .from(externalIds)
        .where(and(eq(externalIds.source, "hardcover"), eq(externalIds.entityType, "book"), eq(externalIds.entityId, bookId)))
        .get()?.url;

    const listItemIds = db
        .select({ id: listItems.id })
        .from(listItems)
        .where(eq(listItems.bookId, bookId))
        .all()
        .map((item) => item.id);
    const unsynced =
        (entry ? hasPendingChanges("library_entry", [entry.id]) : false) || hasPendingChanges("list_item", listItemIds);

    return {
        book,
        entry,
        edition,
        readHistory,
        lists: allLists.map((list) => ({ ...list, onList: onLists.has(list.id) })),
        owned,
        hardcoverUrl,
        unsynced,
    };
}

function formatDate(value: string | null): string | null {
    if (!value) return null;
    const date = new Date(`${value.slice(0, 10)}T00:00:00`);
    return Number.isNaN(date.getTime())
        ? value
        : date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="flex flex-col gap-3 rounded-2xl border border-brand-line bg-brand-surface p-5">
            <h2 className="text-sm font-bold tracking-widest text-brand-muted uppercase">{title}</h2>
            {children}
        </section>
    );
}

function Fact({ label, value }: { label: string; value: string | number | null | undefined }) {
    if (value === null || value === undefined || value === "") return null;
    return (
        <div className="flex justify-between gap-4 text-sm">
            <dt className="text-brand-muted">{label}</dt>
            <dd className="text-right">{value}</dd>
        </div>
    );
}

async function BookDetail({ params }: { params: Promise<{ id: string }> }) {
    await connection();
    const { id } = await params;
    const data = loadBook(id);
    if (!data) notFound();
    const { book, entry, edition, readHistory, hardcoverUrl, unsynced } = data;
    const isbn13 = edition?.isbn13;

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-6 sm:flex-row">
                {book.coverUrl ? (
                    <Image
                        src={book.coverUrl}
                        alt={`Cover of ${book.title}`}
                        width={180}
                        height={270}
                        className="h-auto w-40 shrink-0 self-start rounded-lg shadow-lg sm:w-44"
                    />
                ) : (
                    <div className="h-64 w-44 shrink-0 rounded-lg bg-brand-line" />
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-4">
                    <div>
                        <h1 className="text-3xl font-extrabold tracking-tight">{book.title}</h1>
                        {book.subtitle ? <p className="text-lg text-brand-soft">{book.subtitle}</p> : null}
                        <p className="text-brand-muted">{book.authors.join(", ") || "Unknown author"}</p>
                    </div>

                    {entry ? (
                        <EntryControls
                            entryId={entry.id}
                            status={entry.status}
                            rating={entry.rating}
                            owned={data.owned}
                            hidden={entry.hiddenAt !== null}
                            statusOptions={STATUS_OPTIONS}
                        />
                    ) : (
                        <p className="text-sm text-brand-muted">
                            {data.owned
                                ? "On your Owned list, with no reading status yet, so it isn't in your library."
                                : "On one of your lists but not in your library, so there's no status or rating to edit."}
                        </p>
                    )}

                    {book.localOnly ? (
                        <p className="self-start rounded-full bg-brand-line px-3 py-1 text-xs font-bold text-brand-soft">
                            Here only · Hardcover doesn&rsquo;t have this book
                        </p>
                    ) : unsynced ? (
                        <p className="self-start rounded-full bg-status-reading/15 px-3 py-1 text-xs font-bold text-status-reading">
                            Saved here · not on Hardcover yet
                        </p>
                    ) : null}
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
                <div className="flex flex-col gap-6">
                    {book.description ? (
                        <Section title="About">
                            <p className="whitespace-pre-line text-brand-soft">{book.description}</p>
                        </Section>
                    ) : null}

                    <Section title="Reads">
                        {readHistory.length === 0 ? (
                            <p className="text-sm text-brand-muted">No reads recorded.</p>
                        ) : (
                            <ul className="flex flex-col gap-2 text-sm">
                                {readHistory.map((read) => (
                                    <li key={read.id} className="flex flex-wrap justify-between gap-2">
                                        <span>
                                            {!read.startedAt && !read.finishedAt
                                                ? "Dates not recorded"
                                                : `${formatDate(read.startedAt) ?? "Start unknown"} → ${formatDate(read.finishedAt) ?? "in progress"}`}
                                        </span>
                                        {read.progressPercent !== null && !read.finishedAt ? (
                                            <span className="text-brand-muted">{Math.round(read.progressPercent)}%</span>
                                        ) : null}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Section>
                </div>

                <div className="flex flex-col gap-6">
                    <Section title="Lists">
                        <ListMembership bookId={book.id} lists={data.lists} />
                    </Section>

                    <Section title="Details">
                        <dl className="flex flex-col gap-2">
                            <Fact label="Pages" value={edition?.pages ?? book.pageCount} />
                            <Fact label="Published" value={formatDate(book.firstPublished)} />
                            <Fact label="Format" value={edition?.format} />
                            <Fact label="Publisher" value={edition?.publisher} />
                            <Fact label="ISBN-13" value={isbn13} />
                            <Fact label="ISBN-10" value={edition?.isbn10} />
                            <Fact label="Added" value={formatDate(entry?.addedAt ?? null)} />
                        </dl>
                    </Section>

                    <Section title="Elsewhere">
                        <ul className="flex flex-col gap-2 text-sm">
                            {hardcoverUrl ? (
                                <li>
                                    <a href={hardcoverUrl} target="_blank" rel="noreferrer" className="text-brand-accent hover:underline">
                                        Hardcover ↗
                                    </a>
                                </li>
                            ) : null}
                            {isbn13 ? (
                                <li>
                                    <a
                                        href={`https://openlibrary.org/isbn/${isbn13}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-brand-accent hover:underline"
                                    >
                                        Open Library ↗
                                    </a>
                                </li>
                            ) : null}
                            {!hardcoverUrl && !isbn13 ? <li className="text-brand-muted">No links yet.</li> : null}
                        </ul>
                    </Section>
                </div>
            </div>
        </div>
    );
}

export default function BookPage(props: PageProps<"/books/[id]">) {
    return (
        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
            <Link href="/library" className="text-sm text-brand-muted hover:text-brand-text">
                ← Library
            </Link>
            <Suspense fallback={<p className="text-brand-muted">Fetching from the hoard…</p>}>
                <BookDetail params={props.params} />
            </Suspense>
        </main>
    );
}
