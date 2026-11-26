import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { recentlyAdded } from "@/lib/library-rows";

const COUNT = 12;

/** A sideways strip of the newest books in the hoard. */
export async function NewestBooks() {
    await connection();
    const books = recentlyAdded(COUNT);
    if (books.length === 0) return null;

    return (
        <section className="flex flex-col gap-3 rounded-2xl border border-brand-line bg-brand-surface p-6">
            <div className="flex items-baseline justify-between gap-4">
                <h2 className="text-sm font-bold tracking-widest text-brand-muted uppercase">Newly hoarded</h2>
                <Link href="/library" className="text-sm font-bold text-brand-accent hover:text-brand-accent-alt">
                    See all →
                </Link>
            </div>
            <ul
                aria-label="Newly added books"
                tabIndex={0}
                className="-mx-2 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-2 px-2 pb-3 focus-visible:outline-2 focus-visible:outline-brand-accent"
            >
                {books.map((book) => (
                    <li key={book.id} className="w-24 shrink-0 snap-start">
                        <Link href={`/books/${book.bookId}`} className="group flex flex-col gap-2">
                            {book.coverUrl ? (
                                <Image
                                    src={book.coverUrl}
                                    alt=""
                                    width={96}
                                    height={144}
                                    className="h-36 w-24 rounded object-cover shadow-md transition group-hover:-translate-y-1"
                                />
                            ) : (
                                <div className="flex h-36 w-24 items-center justify-center overflow-hidden rounded bg-brand-line p-2 text-center text-xs text-brand-muted">
                                    <span className="line-clamp-5">{book.title}</span>
                                </div>
                            )}
                            <span className="line-clamp-2 text-xs font-bold group-hover:text-brand-accent">{book.title}</span>
                        </Link>
                    </li>
                ))}
            </ul>
        </section>
    );
}

export function NewestBooksFallback() {
    return <div className="h-60 rounded-2xl border border-brand-line bg-brand-surface" />;
}
