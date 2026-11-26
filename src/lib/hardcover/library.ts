import "server-only";

import { hardcoverRequest } from "./client";

export interface HcBook {
    id: number;
    slug: string | null;
    title: string;
    subtitle: string | null;
    description: string | null;
    pages: number | null;
    release_date: string | null;
    cached_image: { url?: string | null } | null;
    cached_contributors: { author?: { name?: string | null } | null; contribution?: string | null }[] | null;
}

export interface HcEdition {
    id: number;
    isbn_10: string | null;
    isbn_13: string | null;
    edition_format: string | null;
    physical_format: string | null;
    pages: number | null;
    publisher: { name: string | null } | null;
}

export interface HcRead {
    id: number;
    started_at: string | null;
    finished_at: string | null;
    progress: number | null;
    progress_pages: number | null;
}

export interface HcUserBook {
    id: number;
    status_id: number | null;
    /** Postgres `numeric`, which can arrive as a string. */
    rating: number | string | null;
    review_raw: string | null;
    owned: boolean | null;
    privacy_setting_id: number | null;
    private_notes: string | null;
    date_added: string | null;
    updated_at: string | null;
    book: HcBook;
    edition: HcEdition | null;
    user_book_reads: HcRead[];
}

export interface HcListBook {
    id: number;
    position: number | null;
    date_added: string | null;
    book: HcBook;
}

export interface HcList {
    id: number;
    name: string;
    description: string | null;
    ranked: boolean | null;
    privacy_setting_id: number | null;
    updated_at: string | null;
    list_books: HcListBook[];
}

const BOOK_FIELDS = /* GraphQL */ `
    id
    slug
    title
    subtitle
    description
    pages
    release_date
    cached_image
    cached_contributors
`;

const LIBRARY_PAGE_QUERY = /* GraphQL */ `
    query LibraryPage($where: user_books_bool_exp!, $limit: Int!, $offset: Int!) {
        user_books(where: $where, order_by: { id: asc }, limit: $limit, offset: $offset) {
            id
            status_id
            rating
            review_raw
            owned
            privacy_setting_id
            private_notes
            date_added
            updated_at
            book { ${BOOK_FIELDS} }
            edition {
                id
                isbn_10
                isbn_13
                edition_format
                physical_format
                pages
                publisher { name }
            }
            user_book_reads(order_by: { id: asc }) {
                id
                started_at
                finished_at
                progress
                progress_pages
            }
        }
    }
`;

const LISTS_PAGE_QUERY = /* GraphQL */ `
    query ListsPage($userId: Int!, $limit: Int!, $offset: Int!) {
        lists(where: { user_id: { _eq: $userId } }, order_by: { id: asc }, limit: $limit, offset: $offset) {
            id
            name
            description
            ranked
            privacy_setting_id
            updated_at
            list_books(order_by: [{ position: asc_nulls_last }, { date_added: asc }, { id: asc }]) {
                id
                position
                date_added
                book { ${BOOK_FIELDS} }
            }
        }
    }
`;

export const LIBRARY_PAGE_SIZE = 200;
export const LISTS_PAGE_SIZE = 100;

export async function fetchLibraryPage(
    userId: number,
    offset: number,
    updatedSince: string | null,
): Promise<HcUserBook[]> {
    const where: Record<string, unknown> = { user_id: { _eq: userId } };
    if (updatedSince) where.updated_at = { _gt: updatedSince };
    const data = await hardcoverRequest<{ user_books: HcUserBook[] }>(LIBRARY_PAGE_QUERY, {
        where,
        limit: LIBRARY_PAGE_SIZE,
        offset,
    });
    return data.user_books;
}

export async function fetchListsPage(userId: number, offset: number): Promise<HcList[]> {
    const data = await hardcoverRequest<{ lists: HcList[] }>(LISTS_PAGE_QUERY, {
        userId,
        limit: LISTS_PAGE_SIZE,
        offset,
    });
    return data.lists;
}
