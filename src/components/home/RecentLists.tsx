import Link from "next/link";
import { connection } from "next/server";
import { ListCard } from "@/components/lists/ListCard";
import { listSummaries } from "@/lib/lists";

const COUNT = 3;

/** The lists you last added books to. */
export async function RecentLists() {
    await connection();
    const summaries = listSummaries();
    if (summaries.length === 0) return null;

    return (
        <section className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-4">
                <h2 className="text-sm font-bold tracking-widest text-brand-muted uppercase">Your lists</h2>
                <Link href="/lists" className="text-sm font-bold text-brand-accent hover:text-brand-accent-alt">
                    All lists →
                </Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
                {summaries.slice(0, COUNT).map((list) => (
                    <ListCard key={list.id} list={list} />
                ))}
            </div>
        </section>
    );
}
