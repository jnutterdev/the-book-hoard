import Image from "next/image";
import { connection } from "next/server";
import { Suspense } from "react";
import { and, count, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { libraryEntries, lists } from "@/db/schema";
import { HardcoverCard, HardcoverCardFallback } from "@/components/HardcoverCard";

async function HoardCounts() {
    // better-sqlite3 is synchronous, so mark this as request-time work or Next bakes the counts in at build.
    await connection();
    const [bookCount] = await db
        .select({ n: count() })
        .from(libraryEntries)
        .where(and(isNull(libraryEntries.deletedAt), isNull(libraryEntries.hiddenAt)));
    const [listCount] = await db
        .select({ n: count() })
        .from(lists)
        .where(isNull(lists.deletedAt));

    return (
        <p className="text-brand-muted">
            <span className="text-3xl font-extrabold text-brand-accent">
                {bookCount.n}
            </span>{" "}
            books ·{" "}
            <span className="text-3xl font-extrabold text-brand-accent">
                {listCount.n}
            </span>{" "}
            lists
        </p>
    );
}

export default function Home() {
    return (
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
            <header className="flex items-center gap-4">
                <Image
                    src="/art/dragon-head.png"
                    alt="a chibi dragonhead"
                    width={64}
                    height={60}
                    priority
                    className="h-auto w-auto -rotate-6"
                    loading="eager"
                />
                <div>
                    <h1 className="text-4xl font-extrabold tracking-tight">
                        The Book Hoard
                    </h1>
                    <p className="text-brand-muted">a very organized pile</p>
                </div>
            </header>

            <section className="flex items-center justify-between gap-6 rounded-2xl border border-brand-line bg-brand-surface p-6">
                <div className="flex flex-col gap-2">
                    <h2 className="text-sm font-bold tracking-widest text-brand-muted uppercase">
                        Your hoard
                    </h2>
                    <Suspense
                        fallback={<p className="text-brand-muted">Counting…</p>}
                    >
                        <HoardCounts />
                    </Suspense>
                </div>
                <Image
                    src="/art/dragon-napping-on-emptyshelf.png"
                    alt="a chibi dragon napping on an empty shelf"
                    width={140}
                    height={140}
                    loading="eager"
                    className="h-auto w-16"
                />
            </section>

            <Suspense fallback={<HardcoverCardFallback />}>
                <HardcoverCard />
            </Suspense>
        </main>
    );
}
