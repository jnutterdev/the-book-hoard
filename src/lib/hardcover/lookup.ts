import "server-only";

import type { ImportCandidate } from "@/db/schema";
import { hardcoverRequest } from "./client";
import { BOOK_FIELDS, EDITION_FIELDS, type HcBook, type HcEdition } from "./library";

export interface HcEditionWithBook extends HcEdition {
    asin: string | null;
    book: HcBook;
}

const ISBN_CHUNK = 100;

const EDITIONS_BY_ID_QUERY = /* GraphQL */ `
    query Editions($where: editions_bool_exp!) {
        editions(where: $where, limit: 500) {
            ${EDITION_FIELDS}
            asin
            book { ${BOOK_FIELDS} }
        }
    }
`;

const BOOKS_BY_ID_QUERY = /* GraphQL */ `
    query BooksById($ids: [Int!]!) {
        books(where: { id: { _in: $ids } }) { ${BOOK_FIELDS} }
    }
`;

const SEARCH_QUERY = /* GraphQL */ `
    query SearchBooks($query: String!, $perPage: Int!) {
        search(query: $query, query_type: "Book", per_page: $perPage) { results }
    }
`;

const USER_BOOK_QUERY = /* GraphQL */ `
    query UserBookForBook($userId: Int!, $bookId: Int!) {
        user_books(where: { user_id: { _eq: $userId }, book_id: { _eq: $bookId } }, limit: 1) { id }
    }
`;

function chunks<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

/** Hardcover editions matching any of these ISBNs or ASINs, a few requests in total. */
export async function findEditions(ids: { isbn13: string[]; isbn10: string[]; asin: string[] }): Promise<HcEditionWithBook[]> {
    const found: HcEditionWithBook[] = [];
    const groups: [keyof typeof ids, string][] = [
        ["isbn13", "isbn_13"],
        ["isbn10", "isbn_10"],
        ["asin", "asin"],
    ];
    for (const [key, column] of groups) {
        for (const chunk of chunks([...new Set(ids[key])], ISBN_CHUNK)) {
            const data = await hardcoverRequest<{ editions: HcEditionWithBook[] }>(EDITIONS_BY_ID_QUERY, {
                where: { [column]: { _in: chunk } },
            });
            found.push(...data.editions);
        }
    }
    return found;
}

export async function fetchBooks(ids: number[]): Promise<HcBook[]> {
    const books: HcBook[] = [];
    for (const chunk of chunks([...new Set(ids)], ISBN_CHUNK)) {
        const data = await hardcoverRequest<{ books: HcBook[] }>(BOOKS_BY_ID_QUERY, { ids: chunk });
        books.push(...data.books);
    }
    return books;
}

interface SearchDocument {
    id?: string | number;
    title?: string;
    author_names?: string[];
    release_year?: number | null;
    users_count?: number | null;
    image?: { url?: string | null } | null;
}

/** Hardcover's book search, best matches first. */
export async function searchBooks(query: string, perPage = 5): Promise<ImportCandidate[]> {
    const data = await hardcoverRequest<{ search: { results: { hits?: { document: SearchDocument }[] } | null } }>(
        SEARCH_QUERY,
        { query, perPage },
    );
    return (data.search.results?.hits ?? [])
        .map(({ document }) => ({
            hcBookId: Number(document.id),
            hcEditionId: null,
            title: document.title ?? "Untitled",
            authors: document.author_names ?? [],
            year: document.release_year ?? null,
            imageUrl: document.image?.url ?? null,
            readers: document.users_count ?? 0,
        }))
        .filter((candidate) => Number.isFinite(candidate.hcBookId));
}

/** The person's existing Hardcover library entry for a book, if any. */
export async function findUserBookId(userId: number, bookId: number): Promise<number | null> {
    const data = await hardcoverRequest<{ user_books: { id: number }[] }>(USER_BOOK_QUERY, { userId, bookId });
    return data.user_books[0]?.id ?? null;
}

export async function fetchEditions(ids: number[]): Promise<HcEditionWithBook[]> {
    const found: HcEditionWithBook[] = [];
    for (const chunk of chunks([...new Set(ids)], ISBN_CHUNK)) {
        const data = await hardcoverRequest<{ editions: HcEditionWithBook[] }>(EDITIONS_BY_ID_QUERY, {
            where: { id: { _in: chunk } },
        });
        found.push(...data.editions);
    }
    return found;
}
