import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { BookTable } from "@/components/library/BookTable";
import { SortLinks } from "@/components/library/SortLinks";
import { loadListBooks } from "@/lib/library-rows";
import { parseSort, sortRows } from "@/lib/library-sort";
import { ownedBookIds, ownedListId } from "@/lib/list-membership";
import { findList } from "@/lib/lists";

async function ListBooks({ params, searchParams }: PageProps<"/lists/[id]">) {
    await connection();
    const { id } = await params;
    const query = await searchParams;
    const list = findList(id);
    if (!list) notFound();

    const sort = parseSort(
        typeof query.sort === "string" ? query.sort : undefined,
        typeof query.dir === "string" ? query.dir : undefined,
    );
    const rows = sortRows(loadListBooks(list.id), sort.key, sort.dir);
    const ownedIds = ownedListId() ? ownedBookIds() : null;

    return (
        <>
            <div className="flex flex-col gap-1">
                <Link href="/lists" className="text-sm text-brand-muted hover:text-brand-text">
                    ← Lists
                </Link>
                <h1 className="text-3xl font-extrabold tracking-tight">{list.name}</h1>
                <p className="text-brand-muted">
                    {rows.length} {rows.length === 1 ? "book" : "books"}
                    {list.description ? ` · ${list.description}` : ""}
                </p>
            </div>
            {rows.length === 0 ? (
                <p className="text-brand-muted">Nothing on this list yet.</p>
            ) : (
                <div className="flex flex-col gap-4">
                    <SortLinks path={`/lists/${list.id}`} params={{}} sort={sort} />
                    <BookTable rows={rows} ownedIds={ownedIds} />
                </div>
            )}
        </>
    );
}

export default function ListPage(props: PageProps<"/lists/[id]">) {
    return (
        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
            <Suspense fallback={<p className="text-brand-muted">Opening the list…</p>}>
                <ListBooks {...props} />
            </Suspense>
        </main>
    );
}
