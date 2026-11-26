import "server-only";

import { HardcoverError, hardcoverRequest } from "./client";
import { BOOK_FIELDS, type HcBook } from "./library";

/** Fields of `UserBookUpdateInput` this app writes. Hardcover has no `owned` here; ownership is the Owned list. */
export interface UserBookChanges {
    status_id?: number;
    rating?: number | null;
    review_markdown?: string | null;
    private_notes?: string | null;
}

const UPDATE_USER_BOOK = /* GraphQL */ `
    mutation UpdateUserBook($id: Int!, $object: UserBookUpdateInput!) {
        update_user_book(id: $id, object: $object) {
            id
            error
        }
    }
`;

const INSERT_LIST_BOOK = /* GraphQL */ `
    mutation InsertListBook($object: ListBookInput!) {
        insert_list_book(object: $object) {
            id
        }
    }
`;

const DELETE_LIST_BOOK = /* GraphQL */ `
    mutation DeleteListBook($id: Int!) {
        delete_list_book(id: $id) {
            id
        }
    }
`;

export async function updateUserBook(userBookId: number, changes: UserBookChanges): Promise<void> {
    const data = await hardcoverRequest<{ update_user_book: { id: number | null; error: string | null } | null }>(
        UPDATE_USER_BOOK,
        { id: userBookId, object: changes },
    );
    const result = data.update_user_book;
    if (!result || result.error) {
        throw new HardcoverError("graphql", result?.error ?? "Hardcover didn't confirm the update");
    }
}

export async function insertListBook(input: {
    listId: number;
    bookId: number;
    editionId: number | null;
}): Promise<number> {
    const data = await hardcoverRequest<{ insert_list_book: { id: number | null } | null }>(INSERT_LIST_BOOK, {
        object: { list_id: input.listId, book_id: input.bookId, edition_id: input.editionId },
    });
    const id = data.insert_list_book?.id;
    if (!id) throw new HardcoverError("graphql", "Hardcover didn't return the new list entry");
    return id;
}

export async function deleteListBook(listBookId: number): Promise<void> {
    const data = await hardcoverRequest<{ delete_list_book: { id: number | null } | null }>(DELETE_LIST_BOOK, {
        id: listBookId,
    });
    if (!data.delete_list_book?.id) {
        throw new HardcoverError("graphql", "Hardcover didn't confirm the removal");
    }
}

const INSERT_USER_BOOK = /* GraphQL */ `
    mutation InsertUserBook($object: UserBookCreateInput!) {
        insert_user_book(object: $object) {
            id
            error
        }
    }
`;

export interface NewUserBook {
    book_id: number;
    edition_id: number | null;
    status_id: number;
    rating: number | null;
}

/** Adds a book to the Hardcover library. Returns the new `user_books` id. */
export async function insertUserBook(object: NewUserBook): Promise<number> {
    const data = await hardcoverRequest<{ insert_user_book: { id: number | null; error: string | null } | null }>(
        INSERT_USER_BOOK,
        { object },
    );
    const result = data.insert_user_book;
    if (!result || result.error || !result.id) {
        throw new HardcoverError("graphql", result?.error ?? "Hardcover didn't return the new library entry");
    }
    return result.id;
}

const INSERT_BOOK = /* GraphQL */ `
    mutation InsertBook($edition: EditionInput!) {
        insert_book(edition: $edition) {
            id
            created
            matched_by
            errors
            throttled
            edition {
                id
                book { ${BOOK_FIELDS} }
            }
        }
    }
`;

/** Fields of Hardcover's `BookDtoInput` this app sends. */
export interface NewBookDto {
    title: string;
    subtitle?: string;
    isbn_13?: string;
    isbn_10?: string;
    page_count?: number;
    release_date?: string;
    edition_format?: string;
    publisher_id?: number;
    contributions: { author_id: number }[];
}

export interface InsertedBook {
    editionId: number;
    book: HcBook;
    created: boolean;
    matchedBy: string | null;
}

/**
 * Creates a book in Hardcover's shared catalog (or gets back the existing one
 * Hardcover matches it to). This is public: call it for one book at a time,
 * only when the person asks.
 */
export async function insertBook(dto: NewBookDto): Promise<InsertedBook> {
    const data = await hardcoverRequest<{
        insert_book: {
            id: number | null;
            created: boolean | null;
            matched_by: string | null;
            errors: string[] | null;
            throttled: boolean | null;
            edition: { id: number; book: HcBook } | null;
        } | null;
    }>(INSERT_BOOK, { edition: { dto } });
    const result = data.insert_book;
    if (result?.throttled) throw new HardcoverError("rate_limited", "Hardcover is limiting new books right now");
    if (!result || (result.errors && result.errors.length > 0) || !result.edition) {
        throw new HardcoverError("graphql", result?.errors?.join("; ") || "Hardcover didn't return the new book");
    }
    return {
        editionId: result.edition.id,
        book: result.edition.book,
        created: result.created === true,
        matchedBy: result.matched_by,
    };
}
