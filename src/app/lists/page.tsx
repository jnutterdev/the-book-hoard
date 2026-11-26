import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ListCard } from "@/components/lists/ListCard";
import { listSummaries } from "@/lib/lists";

export const metadata: Metadata = { title: "Lists" };

async function AllLists() {
    await connection();
    const summaries = listSummaries();
    if (summaries.length === 0) {
        return <p className="text-brand-muted">No lists yet. Make one on Hardcover, then sync.</p>;
    }
    return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {summaries.map((list) => (
                <ListCard key={list.id} list={list} />
            ))}
        </div>
    );
}

export default function ListsPage() {
    return (
        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
            <h1 className="text-3xl font-extrabold tracking-tight">Lists</h1>
            <Suspense fallback={<p className="text-brand-muted">Gathering lists…</p>}>
                <AllLists />
            </Suspense>
        </main>
    );
}
