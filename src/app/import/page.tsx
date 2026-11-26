import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { desc, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { imports } from "@/db/schema";
import { UploadForm } from "@/components/import/UploadForm";

export const metadata: Metadata = { title: "Import" };

const STATUS_LABEL = {
    parsing: "Matching…",
    review: "Waiting for your review",
    committed: "Imported",
    failed: "Failed while matching",
} as const;

function formatTime(iso: string): string {
    return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

async function PastImports() {
    await connection();
    const rows = db.select().from(imports).where(isNull(imports.deletedAt)).orderBy(desc(imports.createdAt)).all();
    if (rows.length === 0) return null;

    return (
        <section className="flex flex-col gap-3">
            <h2 className="text-lg font-extrabold">Past imports</h2>
            <ul className="flex flex-col gap-2">
                {rows.map((row) => (
                    <li key={row.id}>
                        <Link
                            href={`/import/${row.id}`}
                            className="flex flex-wrap items-baseline justify-between gap-2 rounded-2xl border border-brand-line bg-brand-surface p-4 hover:border-brand-line-strong"
                        >
                            <span className="font-bold">{row.filename}</span>
                            <span className="text-sm text-brand-muted">
                                {STATUS_LABEL[row.status]} · {row.rowCount} rows · {formatTime(row.createdAt)}
                            </span>
                        </Link>
                    </li>
                ))}
            </ul>
        </section>
    );
}

export default function ImportPage() {
    return (
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
            <header className="flex items-center gap-4">
                <Image src="/art/dragon-sleeping-on-books.png" alt="" width={72} height={68} className="h-auto w-18" />
                <div>
                    <h1 className="text-3xl font-extrabold tracking-tight">Import</h1>
                    <p className="text-brand-muted">
                        Bring in a StoryGraph export. Goodreads comes later, once digital and physical copies are sorted out.
                    </p>
                </div>
            </header>
            <UploadForm />
            <Suspense fallback={null}>
                <PastImports />
            </Suspense>
        </main>
    );
}
