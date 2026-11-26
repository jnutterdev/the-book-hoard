export type SortKey = "title" | "author" | "published" | "added" | "rating";
export type SortDir = "asc" | "desc";

export interface SortOption {
    key: SortKey;
    label: string;
    /** Where a fresh click starts: A–Z for text, newest/highest first otherwise. */
    defaultDir: SortDir;
}

export const SORT_OPTIONS: SortOption[] = [
    { key: "title", label: "Title", defaultDir: "asc" },
    { key: "author", label: "Author", defaultDir: "asc" },
    { key: "published", label: "Published", defaultDir: "desc" },
    { key: "added", label: "Added", defaultDir: "desc" },
    { key: "rating", label: "Rating", defaultDir: "desc" },
];

export const DEFAULT_SORT: { key: SortKey; dir: SortDir } = { key: "added", dir: "desc" };

export function parseSort(key: string | undefined, dir: string | undefined): { key: SortKey; dir: SortDir } {
    const option = SORT_OPTIONS.find((o) => o.key === key);
    if (!option) return DEFAULT_SORT;
    return { key: option.key, dir: dir === "asc" || dir === "desc" ? dir : option.defaultDir };
}

/** "The Hobbit" → "hobbit", so titles file the way a shelf does. */
export function titleSortKey(title: string): string {
    return title
        .trim()
        .toLowerCase()
        .replace(/^[^\p{L}\p{N}]+/u, "")
        .replace(/^(the|a|an)\s+/, "");
}

const PARTICLES = new Set(["de", "da", "di", "del", "della", "der", "du", "la", "le", "van", "von", "st.", "mac"]);
const SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv"]);

/**
 * "Ursula K. Le Guin" → "le guin ursula k.", "L. Sprague de Camp" → "de camp l. sprague".
 * A best guess from a full name: Hardcover doesn't say which part is the surname.
 */
export function authorSortKey(name: string): string {
    const parts = name
        .replace(/,/g, " ")
        .split(/\s+/)
        .filter((part) => part.length > 0 && !SUFFIXES.has(part.toLowerCase()));
    if (parts.length <= 1) return (parts[0] ?? "").toLowerCase();
    let start = parts.length - 1;
    while (start > 1 && PARTICLES.has(parts[start - 1].toLowerCase())) start--;
    const surname = parts.slice(start).join(" ");
    const given = parts.slice(0, start).join(" ");
    return `${surname} ${given}`.toLowerCase();
}

/** "1965-08-01" or "1965" → 1965. Sorting and the Published column both go by year. */
export function publishedYear(date: string | null): number | null {
    if (!date) return null;
    const year = Number.parseInt(date.slice(0, 4), 10);
    return Number.isFinite(year) ? year : null;
}

export interface SortableRow {
    title: string;
    authors: string[];
    published: string | null;
    addedAt: string | null;
    rating: number | null;
}

function valueFor(row: SortableRow, key: SortKey): string | number | null {
    switch (key) {
        case "title":
            return titleSortKey(row.title);
        case "author":
            return row.authors[0] ? authorSortKey(row.authors[0]) : null;
        case "published":
            return publishedYear(row.published);
        case "added":
            return row.addedAt;
        case "rating":
            return row.rating;
    }
}

function compareValues(a: string | number, b: string | number): number {
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a).localeCompare(String(b), "en", { sensitivity: "base", numeric: true });
}

/** Sorts a copy. Missing values (no author, no date, no rating) always go last, whichever way it runs. */
export function sortRows<T extends SortableRow>(rows: T[], key: SortKey, dir: SortDir): T[] {
    const sign = dir === "asc" ? 1 : -1;
    return rows
        .map((row) => ({ row, value: valueFor(row, key), title: titleSortKey(row.title) }))
        .sort((a, b) => {
            if (a.value === null && b.value !== null) return 1;
            if (b.value === null && a.value !== null) return -1;
            const primary = a.value === null || b.value === null ? 0 : sign * compareValues(a.value, b.value);
            return primary !== 0 ? primary : compareValues(a.title, b.title);
        })
        .map(({ row }) => row);
}
