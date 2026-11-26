import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import type { ImportCandidate, ParsedImportRow, ReadingStatus } from "@/db/schema";
import {
    ChooseAll,
    CommitBar,
    NotThisBook,
    PickButton,
    ReviewTools,
    SidePicker,
} from "@/components/import/ImportActions";
import { getImportPreview, type FieldDiff, type RowPlan } from "@/lib/import/plan";
import { STATUS_INFO } from "@/lib/reading-status";

export const metadata: Metadata = { title: "Review import" };

const COVER_HOST = "https://assets.hardcover.app/";

function Cover({ url }: { url: string | null }) {
    if (!url || !url.startsWith(COVER_HOST)) return <div className="h-15 w-10 shrink-0 rounded bg-brand-line" />;
    return <Image src={url} alt="" width={40} height={60} className="h-15 w-10 shrink-0 rounded object-cover" />;
}

function statusLabel(status: number | null): string {
    return status === null ? "No status" : (STATUS_INFO[status as ReadingStatus]?.label ?? `Status ${status}`);
}

function ratingLabel(rating: number | null): string {
    return rating === null ? "No rating" : `${rating} ★`;
}

function diffLabel(diff: FieldDiff, side: "incoming" | "current"): string {
    const value = diff[side];
    return diff.field === "status" ? statusLabel(value) : ratingLabel(value);
}

function rowLine(parsed: ParsedImportRow): string {
    return [
        parsed.authors.slice(0, 2).join(", "),
        parsed.format,
        parsed.isbn13 ?? parsed.isbn10 ?? parsed.asin ?? "no ISBN",
    ]
        .filter(Boolean)
        .join(" · ");
}

function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-3 rounded-2xl border border-brand-line bg-brand-surface p-4">
            <div>
                <h2 className="text-lg font-extrabold">{title}</h2>
                {hint ? <p className="text-sm text-brand-muted">{hint}</p> : null}
            </div>
            {children}
        </section>
    );
}

function Rows({ children }: { children: ReactNode }) {
    return <ul className="flex flex-col gap-3">{children}</ul>;
}

function Row({ children }: { children: ReactNode }) {
    return (
        <li className="flex flex-wrap items-start justify-between gap-3 border-t border-brand-line pt-3 first:border-t-0 first:pt-0">
            {children}
        </li>
    );
}

function MatchedBook({ plan, detail, editable }: { plan: RowPlan; detail?: ReactNode; editable: boolean }) {
    const match = plan.match;
    const renamed = match && match.title.trim().toLowerCase() !== plan.parsed.title.trim().toLowerCase();
    return (
        <div className="flex min-w-0 flex-1 gap-3">
            <Cover url={match?.imageUrl ?? null} />
            <div className="min-w-0 flex-1">
                {plan.bookId ? (
                    <Link href={`/books/${plan.bookId}`} className="font-bold hover:underline">
                        {plan.parsed.title}
                    </Link>
                ) : (
                    <span className="font-bold">{plan.parsed.title}</span>
                )}
                <p className="text-xs text-brand-muted">{rowLine(plan.parsed)}</p>
                {renamed ? (
                    <p className="text-xs text-brand-soft">
                        Hardcover: {match.title}
                        {match.authors.length ? ` by ${match.authors.slice(0, 2).join(", ")}` : ""}
                    </p>
                ) : null}
                {detail}
            </div>
            {editable ? <NotThisBook rowId={plan.rowId} /> : null}
        </div>
    );
}

function Candidate({ rowId, candidate }: { rowId: string; candidate: ImportCandidate }) {
    return (
        <li className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
                <Cover url={candidate.imageUrl} />
                <div className="min-w-0">
                    <p className="font-bold">{candidate.title}</p>
                    <p className="text-xs text-brand-muted">
                        {[candidate.authors.slice(0, 3).join(", "), candidate.year, `${candidate.readers} readers`]
                            .filter(Boolean)
                            .join(" · ")}
                    </p>
                </div>
            </div>
            <PickButton rowId={rowId} hcBookId={candidate.hcBookId} />
        </li>
    );
}

async function ImportReview({ params }: { params: Promise<{ id: string }> }) {
    await connection();
    const { id } = await params;
    const preview = getImportPreview(id);
    if (!preview) notFound();
    const editable = preview.status === "review";

    if (preview.status === "committed") {
        return (
            <Section title="Imported" hint="This import is in the library. Its changes go to Hardcover on each sync.">
                <p className="text-sm text-brand-soft">
                    Check what&rsquo;s still waiting to send on the <Link href="/sync" className="underline">Sync page</Link>.
                </p>
            </Section>
        );
    }
    if (preview.status === "failed") {
        return (
            <Section title="Matching failed" hint="Hardcover stopped answering partway through. Discard this one and upload the file again.">
                <CommitBar importId={preview.importId} ready={false} blocker={null} />
            </Section>
        );
    }

    const undecided = preview.differences.reduce(
        (n, plan) => n + plan.diffs.filter((diff) => diff.choice === null).length,
        0,
    );
    const blocker =
        preview.needsReview.length > 0
            ? `${preview.needsReview.length} books still need a match or a skip`
            : undecided > 0
              ? `${undecided} differences still need a pick`
              : null;

    return (
        <div className="flex flex-col gap-4">
            <Section title="Summary">
                <p className="text-sm text-brand-soft">
                    {preview.rowCount} rows: {preview.addToLibrary.length} to add to the library,{" "}
                    {preview.differences.length} with differences, {preview.ownedOnly.length} owned-only,{" "}
                    {preview.unchanged.length} already up to date, {preview.needsReview.length} to review,{" "}
                    {preview.skipped.length} skipped.
                </p>
                <CommitBar importId={preview.importId} ready={preview.ready} blocker={blocker} />
            </Section>

            {preview.needsReview.length > 0 ? (
                <Section
                    title={`Needs a match (${preview.needsReview.length})`}
                    hint="No confident match on Hardcover. Pick the right book, search again, or skip it."
                >
                    <Rows>
                        {preview.needsReview.map((row) => (
                            <li key={row.rowId} className="flex flex-col gap-3 border-t border-brand-line pt-3 first:border-t-0 first:pt-0">
                                <div>
                                    <p className="font-bold">{row.parsed.title}</p>
                                    <p className="text-xs text-brand-muted">
                                        {rowLine(row.parsed)} · {statusLabel(row.parsed.status)}
                                        {row.parsed.owned && row.parsed.physical ? " · owned" : ""}
                                    </p>
                                    {row.note ? <p className="text-xs text-brand-faint">{row.note}</p> : null}
                                </div>
                                {row.candidates.length > 0 ? (
                                    <ul className="flex flex-col gap-2 pl-2">
                                        {row.candidates.map((candidate) => (
                                            <Candidate key={candidate.hcBookId} rowId={row.rowId} candidate={candidate} />
                                        ))}
                                    </ul>
                                ) : null}
                                <ReviewTools
                                    rowId={row.rowId}
                                    defaultQuery={[row.parsed.title, row.parsed.authors[0]].filter(Boolean).join(" ")}
                                />
                            </li>
                        ))}
                    </Rows>
                </Section>
            ) : null}

            {preview.differences.length > 0 ? (
                <Section
                    title={`Differences (${preview.differences.length})`}
                    hint="StoryGraph and your library disagree. Pick which one wins for each."
                >
                    <ChooseAll importId={preview.importId} />
                    <Rows>
                        {preview.differences.map((plan) => (
                            <Row key={plan.rowId}>
                                <MatchedBook
                                    plan={plan}
                                    editable={editable}
                                    detail={
                                        <div className="mt-2 flex flex-col gap-2">
                                            {plan.diffs.map((diff) => (
                                                <div key={diff.field}>
                                                    <p className="text-xs font-bold text-brand-muted">
                                                        {diff.field === "status" ? "Status" : "Rating"}
                                                    </p>
                                                    <SidePicker
                                                        rowId={plan.rowId}
                                                        field={diff.field}
                                                        choice={diff.choice}
                                                        importLabel={diffLabel(diff, "incoming")}
                                                        currentLabel={diffLabel(diff, "current")}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    }
                                />
                            </Row>
                        ))}
                    </Rows>
                </Section>
            ) : null}

            {preview.addToLibrary.length > 0 ? (
                <Section
                    title={`Add to library (${preview.addToLibrary.length})`}
                    hint="Not in your library yet. These go into Hardcover with this status."
                >
                    <Rows>
                        {preview.addToLibrary.map((plan) => (
                            <Row key={plan.rowId}>
                                <MatchedBook
                                    plan={plan}
                                    editable={editable}
                                    detail={
                                        <p className="text-sm text-brand-soft">
                                            {statusLabel(plan.addToLibrary?.status ?? null)}
                                            {plan.addToLibrary?.rating ? ` · ${ratingLabel(plan.addToLibrary.rating)}` : ""}
                                            {plan.ownedAdd ? " · add to Owned" : ""}
                                            {plan.newReads.length ? ` · read ${plan.newReads.join(", ")}` : ""}
                                        </p>
                                    }
                                />
                            </Row>
                        ))}
                    </Rows>
                </Section>
            ) : null}

            {preview.ownedOnly.length > 0 ? (
                <Section
                    title={`Add to Owned (${preview.ownedOnly.length})`}
                    hint="Physical copies you own, going on the Owned list only. No status gets set."
                >
                    <Rows>
                        {preview.ownedOnly.map((plan) => (
                            <Row key={plan.rowId}>
                                <MatchedBook plan={plan} editable={editable} />
                            </Row>
                        ))}
                    </Rows>
                </Section>
            ) : null}

            {preview.unchanged.length > 0 ? (
                <details className="rounded-2xl border border-brand-line bg-brand-surface p-4">
                    <summary className="cursor-pointer font-extrabold">Already up to date ({preview.unchanged.length})</summary>
                    <ul className="mt-3 flex flex-col gap-1 text-sm text-brand-soft">
                        {preview.unchanged.map((plan) => (
                            <li key={plan.rowId}>
                                {plan.parsed.title}
                                {plan.newReads.length ? ` · saves read date ${plan.newReads.join(", ")}` : ""}
                            </li>
                        ))}
                    </ul>
                </details>
            ) : null}

            {preview.skipped.length > 0 ? (
                <details className="rounded-2xl border border-brand-line bg-brand-surface p-4">
                    <summary className="cursor-pointer font-extrabold">Skipped ({preview.skipped.length})</summary>
                    <ul className="mt-3 flex flex-col gap-1 text-sm text-brand-soft">
                        {preview.skipped.map((row) => (
                            <li key={row.rowId}>
                                {row.title} <span className="text-brand-faint">· {row.note}</span>
                            </li>
                        ))}
                    </ul>
                </details>
            ) : null}
        </div>
    );
}

export default function ImportReviewPage(props: PageProps<"/import/[id]">) {
    return (
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
            <header>
                <Link href="/import" className="text-sm text-brand-muted hover:text-brand-text">
                    ← Imports
                </Link>
                <h1 className="text-3xl font-extrabold tracking-tight">Review import</h1>
            </header>
            <Suspense fallback={<p className="text-brand-muted">Loading the import…</p>}>
                <ImportReview params={props.params} />
            </Suspense>
        </main>
    );
}
