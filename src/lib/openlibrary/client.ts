import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { openLibraryCache, type BookDetails } from "@/db/schema";
import { DAY_MS } from "@/lib/dates";
import { sleep } from "@/lib/hardcover/rate-limiter";
import { log } from "@/lib/log";

const BASE_URL = "https://openlibrary.org";
const COVER_URL = "https://covers.openlibrary.org/b/id";
/** Generic on purpose: no personal details go to Open Library. */
const USER_AGENT = "TheBookHoard/0.1 (personal library app)";
const CACHE_MS = 30 * DAY_MS;
/** Open Library asks for gentle use; one request at a time, spaced out. */
const MIN_GAP_MS = 1000;

const globalForOpenLibrary = globalThis as typeof globalThis & { bookHoardOpenLibraryLast?: number };

export class OpenLibraryError extends Error {
    constructor(message: string, readonly status?: number) {
        super(message);
        this.name = "OpenLibraryError";
    }
}

async function fetchJson<T>(path: string): Promise<T> {
    const cached = db.select().from(openLibraryCache).where(eq(openLibraryCache.key, path)).get();
    if (cached && Date.now() - Date.parse(cached.fetchedAt) < CACHE_MS) return cached.payload as T;

    const wait = (globalForOpenLibrary.bookHoardOpenLibraryLast ?? 0) + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    globalForOpenLibrary.bookHoardOpenLibraryLast = Date.now();

    let response: Response;
    try {
        response = await fetch(`${BASE_URL}${path}`, {
            headers: { "user-agent": USER_AGENT, accept: "application/json" },
            signal: AbortSignal.timeout(30_000),
        });
    } catch (error) {
        void log.warn("Open Library request failed", { path }, error);
        throw new OpenLibraryError("Couldn't reach Open Library");
    }
    if (!response.ok) throw new OpenLibraryError(`Open Library answered ${response.status}`, response.status);
    const payload = (await response.json()) as T;

    const fetchedAt = new Date().toISOString();
    db.insert(openLibraryCache)
        .values({ key: path, payload, fetchedAt })
        .onConflictDoUpdate({ target: openLibraryCache.key, set: { payload, fetchedAt } })
        .run();
    return payload;
}

interface OlBooksData {
    title?: string;
    subtitle?: string;
    authors?: { name?: string }[];
    publishers?: { name?: string }[];
    publish_date?: string;
    number_of_pages?: number;
    identifiers?: { isbn_13?: string[]; isbn_10?: string[] };
    cover?: { medium?: string; large?: string };
}

interface OlSearchDoc {
    title?: string;
    subtitle?: string;
    author_name?: string[];
    publisher?: string[];
    first_publish_year?: number;
    number_of_pages_median?: number;
    isbn?: string[];
    cover_i?: number;
}

/** "April 1961", "1961", "Apr 01, 1961" → "1961" (Open Library dates are free text; the year is what's reliable). */
function yearOf(value: string | number | undefined): string | null {
    if (value === undefined) return null;
    const match = String(value).match(/\b(1[5-9]\d{2}|20\d{2})\b/);
    return match ? match[1] : null;
}

function clean(value: string | undefined | null): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

/** Looks a book up by ISBN. Null when Open Library doesn't know it. */
export async function findByIsbn(isbn: string): Promise<BookDetails | null> {
    const key = `ISBN:${isbn}`;
    const data = await fetchJson<Record<string, OlBooksData>>(
        `/api/books?bibkeys=${encodeURIComponent(key)}&format=json&jscmd=data`,
    );
    const book = data[key];
    if (!book) return null;
    return {
        title: clean(book.title),
        subtitle: clean(book.subtitle),
        authors: (book.authors ?? []).flatMap((author) => (author.name ? [author.name.trim()] : [])),
        publisher: clean(book.publishers?.[0]?.name),
        publishDate: yearOf(book.publish_date),
        pages: book.number_of_pages ?? null,
        isbn13: book.identifiers?.isbn_13?.[0] ?? (isbn.length === 13 ? isbn : null),
        isbn10: book.identifiers?.isbn_10?.[0] ?? (isbn.length === 10 ? isbn : null),
        coverUrl: book.cover?.medium ?? null,
    };
}

/** Best title + author match from Open Library's search, or null. */
export async function searchByTitle(title: string, author: string | null): Promise<BookDetails | null> {
    const params = new URLSearchParams({
        title,
        limit: "3",
        fields: "title,subtitle,author_name,publisher,first_publish_year,number_of_pages_median,isbn,cover_i",
    });
    if (author) params.set("author", author);
    const data = await fetchJson<{ docs?: OlSearchDoc[] }>(`/search.json?${params.toString()}`);
    const doc = data.docs?.[0];
    if (!doc) return null;
    const isbns = doc.isbn ?? [];
    return {
        title: clean(doc.title),
        subtitle: clean(doc.subtitle),
        authors: doc.author_name ?? [],
        publisher: clean(doc.publisher?.[0]),
        publishDate: yearOf(doc.first_publish_year),
        pages: doc.number_of_pages_median ?? null,
        isbn13: isbns.find((isbn) => isbn.length === 13) ?? null,
        isbn10: isbns.find((isbn) => isbn.length === 10) ?? null,
        coverUrl: doc.cover_i ? `${COVER_URL}/${doc.cover_i}-M.jpg` : null,
    };
}
