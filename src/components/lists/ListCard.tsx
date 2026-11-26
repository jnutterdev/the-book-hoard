import Image from "next/image";
import Link from "next/link";
import type { ListSummary } from "@/lib/lists";

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/** A list as a card: a fan of its newest covers, its name and size. */
export function ListCard({ list }: { list: ListSummary }) {
    return (
        <Link
            href={`/lists/${list.id}`}
            className="group flex flex-col gap-4 rounded-2xl border border-brand-line bg-brand-surface p-5 transition hover:border-brand-accent"
        >
            <div className="flex h-24 items-end pl-2">
                {list.newest.length === 0 ? (
                    <div className="h-24 w-16 rounded border border-dashed border-brand-line-strong" />
                ) : (
                    list.newest.map((book, index) =>
                        book.coverUrl ? (
                            <Image
                                key={book.id}
                                src={book.coverUrl}
                                alt=""
                                width={64}
                                height={96}
                                className="-ml-6 h-24 w-16 shrink-0 rounded object-cover shadow-lg ring-2 ring-brand-surface first:ml-0"
                                style={{ zIndex: list.newest.length - index }}
                            />
                        ) : (
                            <div
                                key={book.id}
                                className="-ml-6 h-24 w-16 shrink-0 rounded bg-brand-line ring-2 ring-brand-surface first:ml-0"
                                style={{ zIndex: list.newest.length - index }}
                            />
                        ),
                    )
                )}
            </div>
            <div className="min-w-0">
                <p className="truncate font-bold group-hover:text-brand-accent">{list.name}</p>
                <p className="text-sm text-brand-muted">
                    {list.count} {list.count === 1 ? "book" : "books"}
                    {list.lastAddedAt ? ` · last added ${DATE.format(new Date(list.lastAddedAt))}` : ""}
                </p>
            </div>
        </Link>
    );
}
