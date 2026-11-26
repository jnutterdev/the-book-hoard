import type { SyncStats } from "@/db/schema";

function plural(count: number, word: string): string {
    return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** "Pulled 60 books, 1 list" or "Already up to date". */
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
    return sentences.length > 0 ? sentences.join(", ") : "Already up to date";
}
