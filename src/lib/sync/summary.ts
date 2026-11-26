import type { SyncStats } from "@/db/schema";

function plural(count: number, word: string): string {
    return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** "Pulled 60 books, 1 list, sent 2 changes" or "Already up to date". */
export function summarizeStats(stats: SyncStats): string {
    const pulled = [
        stats.booksChanged > 0 ? plural(stats.booksChanged, "book") : null,
        stats.listsChanged > 0 ? plural(stats.listsChanged, "list") : null,
    ].filter((part): part is string => part !== null);
    const removed = [
        stats.booksRemoved > 0 ? plural(stats.booksRemoved, "book") : null,
        stats.listsRemoved > 0 ? plural(stats.listsRemoved, "list") : null,
    ].filter((part): part is string => part !== null);

    const sentences: string[] = [];
    if (pulled.length > 0) sentences.push(`Pulled ${pulled.join(", ")}`);
    if (removed.length > 0) sentences.push(`${sentences.length ? "removed" : "Removed"} ${removed.join(", ")}`);
    const pushed = stats.pushed ?? 0;
    const failed = stats.pushFailed ?? 0;
    const conflicts = stats.conflicts ?? 0;
    if (pushed > 0) sentences.push(`${sentences.length ? "sent" : "Sent"} ${plural(pushed, "change")}`);
    if (failed > 0) sentences.push(`${plural(failed, "change")} couldn't be sent`);
    if (conflicts > 0) sentences.push(`${plural(conflicts, "conflict")} to review`);
    return sentences.length > 0 ? sentences.join(", ") : "Already up to date";
}
