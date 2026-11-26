import Link from "next/link";
import type { ReactNode } from "react";
import { connection } from "next/server";
import { getSyncQueue, type QueueItem } from "@/lib/sync/queue";
import { ApprovalChoices, ConflictChoices, DiscardChoice, FailedChoices, StartSendingButton } from "./QueueActions";

function BookTitle({ bookId, title }: { bookId: string | null; title: string }) {
    if (!bookId) return <span className="font-bold">{title}</span>;
    return (
        <Link href={`/books/${bookId}`} className="font-bold hover:underline">
            {title}
        </Link>
    );
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

function ItemRow({ item, actions }: { item: QueueItem; actions?: ReactNode }) {
    return (
        <li className="flex flex-wrap items-start justify-between gap-3 border-t border-brand-line pt-3 first:border-t-0 first:pt-0">
            <div className="min-w-0">
                <BookTitle bookId={item.bookId} title={item.title} />
                <p className="text-sm text-brand-soft">{item.change}</p>
                {item.lastError ? (
                    <p className="text-xs text-status-dnf">
                        {item.lastError} · tried {item.attempts}×
                    </p>
                ) : null}
            </div>
            {actions}
        </li>
    );
}

/** What's waiting to go to Hardcover, and anything that needs a decision first. */
export async function SyncQueuePanel() {
    await connection();
    const queue = getSyncQueue();
    const total = queue.waiting.length + queue.needsApproval.length + queue.failed.length + queue.conflicts.length;
    if (total === 0) return null;

    return (
        <div className="flex flex-col gap-4">
            {queue.conflicts.length > 0 ? (
                <Section
                    title={`Conflicts (${queue.conflicts.length})`}
                    hint="You and Hardcover both changed these since the last sync. Pick which one wins."
                >
                    <ul className="flex flex-col gap-3">
                        {queue.conflicts.map((conflict) => (
                            <li
                                key={conflict.id}
                                className="flex flex-wrap items-start justify-between gap-3 border-t border-brand-line pt-3 first:border-t-0 first:pt-0"
                            >
                                <div className="min-w-0">
                                    <BookTitle bookId={conflict.bookId} title={conflict.title} />
                                    <p className="text-sm text-brand-soft">
                                        {conflict.field}: <span className="font-bold">mine</span> {conflict.mine} ·{" "}
                                        <span className="font-bold">Hardcover</span> {conflict.theirs}
                                    </p>
                                </div>
                                <ConflictChoices id={conflict.id} />
                            </li>
                        ))}
                    </ul>
                </Section>
            ) : null}

            {queue.needsApproval.length > 0 ? (
                <Section
                    title={`Ready to send (${queue.needsApproval.length})`}
                    hint="Reviews and notes wait for your OK before they go to Hardcover."
                >
                    <ul className="flex flex-col gap-3">
                        {queue.needsApproval.map((item) => (
                            <ItemRow key={item.id} item={item} actions={<ApprovalChoices id={item.id} />} />
                        ))}
                    </ul>
                </Section>
            ) : null}

            {queue.failed.length > 0 ? (
                <Section title={`Couldn't send (${queue.failed.length})`} hint="These failed five times in a row.">
                    <ul className="flex flex-col gap-3">
                        {queue.failed.map((item) => (
                            <ItemRow key={item.id} item={item} actions={<FailedChoices id={item.id} />} />
                        ))}
                    </ul>
                </Section>
            ) : null}

            {queue.waiting.length > 0 ? (
                <Section
                    title={`Waiting to send (${queue.waiting.length})`}
                    hint={
                        queue.pushEnabled
                            ? "These go up on the next sync."
                            : "Nothing has been sent to Hardcover yet. Look these over, then start sending. Discard puts a book back the way Hardcover has it."
                    }
                >
                    {queue.pushEnabled ? null : <StartSendingButton count={queue.waiting.length} />}
                    <ul className="flex flex-col gap-3">
                        {queue.waiting.map((item) => (
                            <ItemRow key={item.id} item={item} actions={<DiscardChoice id={item.id} />} />
                        ))}
                    </ul>
                </Section>
            ) : null}
        </div>
    );
}
