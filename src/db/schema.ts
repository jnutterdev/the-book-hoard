import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const nowIso = (): string => new Date().toISOString();

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const timestamps = {
  createdAt: text("created_at").notNull().$defaultFn(nowIso),
  updatedAt: text("updated_at").notNull().$defaultFn(nowIso).$onUpdateFn(nowIso),
  deletedAt: text("deleted_at"),
};

/** Hardcover's status ids, mirrored so sync never has to translate them. */
export const READING_STATUS = {
  wantToRead: 1,
  reading: 2,
  read: 3,
  paused: 4,
  didNotFinish: 5,
  ignored: 6,
} as const;
export type ReadingStatus = (typeof READING_STATUS)[keyof typeof READING_STATUS];

export type ExternalSource = "hardcover" | "openlibrary" | "goodreads" | "storygraph";
export type SyncedEntity = "book" | "edition" | "library_entry" | "read" | "list" | "list_item";

export const books = sqliteTable("books", {
  id: id(),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  authors: text("authors", { mode: "json" }).$type<string[]>().notNull().default([]),
  description: text("description"),
  coverUrl: text("cover_url"),
  pageCount: integer("page_count"),
  firstPublished: text("first_published"),
  /** Lives in this app only: Hardcover doesn't have it, so sync never sends or removes it. */
  localOnly: integer("local_only", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
});

export const editions = sqliteTable(
  "editions",
  {
    id: id(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id),
    isbn10: text("isbn_10"),
    isbn13: text("isbn_13"),
    format: text("format"),
    publisher: text("publisher"),
    pages: integer("pages"),
    ...timestamps,
  },
  (t) => [index("editions_book_idx").on(t.bookId), index("editions_isbn13_idx").on(t.isbn13)],
);

export const externalIds = sqliteTable(
  "external_ids",
  {
    id: id(),
    entityType: text("entity_type").$type<SyncedEntity>().notNull(),
    entityId: text("entity_id").notNull(),
    source: text("source").$type<ExternalSource>().notNull(),
    externalId: text("external_id").notNull(),
    /** Page for this record on the source site, when it has one. */
    url: text("url"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("external_ids_source_unique").on(t.source, t.entityType, t.externalId),
    index("external_ids_entity_idx").on(t.entityType, t.entityId),
  ],
);

/** Mirrors Hardcover `user_books`. `hiddenAt` is local-only and never synced. */
export const libraryEntries = sqliteTable(
  "library_entries",
  {
    id: id(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id),
    editionId: text("edition_id").references(() => editions.id),
    status: integer("status").$type<ReadingStatus>().notNull(),
    rating: real("rating"),
    review: text("review"),
    owned: integer("owned", { mode: "boolean" }).notNull().default(false),
    privacy: integer("privacy"),
    notes: text("notes"),
    /** Date the book joined the library on Hardcover (`user_books.date_added`). */
    addedAt: text("added_at"),
    hiddenAt: text("hidden_at"),
    ...timestamps,
  },
  (t) => [index("library_entries_book_idx").on(t.bookId), index("library_entries_status_idx").on(t.status)],
);

export const reads = sqliteTable(
  "reads",
  {
    id: id(),
    libraryEntryId: text("library_entry_id")
      .notNull()
      .references(() => libraryEntries.id),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    progressPages: integer("progress_pages"),
    progressPercent: real("progress_percent"),
    ...timestamps,
  },
  (t) => [index("reads_entry_idx").on(t.libraryEntryId)],
);

/** Hardcover's system list that tracks owned editions. Its slug never changes. */
export const OWNED_LIST_SLUG = "owned";

export const lists = sqliteTable("lists", {
  id: id(),
  name: text("name").notNull(),
  /** Hardcover's list slug, e.g. `owned` for the system Owned list. */
  slug: text("slug"),
  description: text("description"),
  privacy: integer("privacy"),
  ranked: integer("ranked", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
});

/** `position` is a fractional index string, so a drag-reorder rewrites one row. */
export const listItems = sqliteTable(
  "list_items",
  {
    id: id(),
    listId: text("list_id")
      .notNull()
      .references(() => lists.id),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id),
    position: text("position").notNull(),
    /** Edition to send with this entry (Hardcover's Owned list stores editions). Optional. */
    editionId: text("edition_id").references(() => editions.id),
    ...timestamps,
  },
  (t) => [index("list_items_list_position_idx").on(t.listId, t.position)],
);

/** Last-seen remote state: the "base" for three-way merges. */
export const syncSnapshots = sqliteTable(
  "sync_snapshots",
  {
    id: id(),
    source: text("source").$type<ExternalSource>().notNull(),
    entityType: text("entity_type").$type<SyncedEntity>().notNull(),
    entityId: text("entity_id").notNull(),
    remoteHash: text("remote_hash").notNull(),
    remotePayload: text("remote_payload", { mode: "json" }).$type<unknown>().notNull(),
    syncedAt: text("synced_at").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("sync_snapshots_entity_unique").on(t.source, t.entityType, t.entityId)],
);

export type OutboxOp = "create" | "update" | "delete";
export type OutboxStatus = "pending" | "sent" | "failed" | "conflict";

export const syncOutbox = sqliteTable(
  "sync_outbox",
  {
    id: id(),
    entityType: text("entity_type").$type<SyncedEntity>().notNull(),
    entityId: text("entity_id").notNull(),
    op: text("op").$type<OutboxOp>().notNull(),
    changedFields: text("changed_fields", { mode: "json" }).$type<string[]>().notNull().default([]),
    status: text("status").$type<OutboxStatus>().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** Each changed field's value before the first local edit: the "base" for conflict checks. */
    baseValues: text("base_values", { mode: "json" }).$type<Record<string, unknown>>(),
    /** Long text (reviews, notes) only pushes once approved. */
    approvedAt: text("approved_at"),
    ...timestamps,
  },
  (t) => [index("sync_outbox_status_idx").on(t.status, t.createdAt)],
);

export type ConflictResolution = "local" | "remote";

export const syncConflicts = sqliteTable(
  "sync_conflicts",
  {
    id: id(),
    entityType: text("entity_type").$type<SyncedEntity>().notNull(),
    entityId: text("entity_id").notNull(),
    field: text("field").notNull(),
    localValue: text("local_value", { mode: "json" }).$type<unknown>(),
    remoteValue: text("remote_value", { mode: "json" }).$type<unknown>(),
    baseValue: text("base_value", { mode: "json" }).$type<unknown>(),
    resolvedAt: text("resolved_at"),
    resolution: text("resolution").$type<ConflictResolution>(),
    ...timestamps,
  },
  (t) => [index("sync_conflicts_open_idx").on(t.resolvedAt)],
);

export type SyncKind = "incremental" | "full";
export type SyncTrigger = "manual" | "auto";

export interface SyncStats {
  booksChanged: number;
  booksRemoved: number;
  listsChanged: number;
  listsRemoved: number;
  /** Push results; absent on runs from before push existed. */
  pushed?: number;
  pushFailed?: number;
  conflicts?: number;
}

/** What went wrong, for the Sync page. Never holds the token or request headers. */
export interface SyncErrorDetail {
  kind: string;
  step: string;
  status?: number;
  graphqlErrors?: { message: string; code?: string }[];
  /** Set by the deletion guard: how many records the run would have removed. */
  wouldRemove?: { books: number; lists: number; listItems: number };
  /** Set when the daily quota ran out. */
  retryAfter?: string;
}

export const syncRuns = sqliteTable(
  "sync_runs",
  {
    id: id(),
    source: text("source").$type<ExternalSource>().notNull(),
    kind: text("kind").$type<SyncKind>().notNull(),
    trigger: text("trigger").$type<SyncTrigger>().notNull().default("manual"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    /** Newest remote `updated_at` seen, used as the next incremental cursor. */
    cursor: text("cursor"),
    pulled: integer("pulled").notNull().default(0),
    pushed: integer("pushed").notNull().default(0),
    conflicts: integer("conflicts").notNull().default(0),
    stats: text("stats", { mode: "json" }).$type<SyncStats>(),
    error: text("error"),
    errorDetail: text("error_detail", { mode: "json" }).$type<SyncErrorDetail>(),
    ...timestamps,
  },
  (t) => [index("sync_runs_started_idx").on(t.startedAt)],
);

export type ImportSource = "goodreads" | "storygraph";
export type ImportStatus = "parsing" | "review" | "committed" | "failed";
export type ImportMatchStatus = "matched" | "needs_review" | "skipped";
export type ImportMatchSource = "local" | "isbn" | "search" | "manual" | "created" | "kept";

/** One CSV row, cleaned up. Source-neutral so Goodreads can reuse it. */
export interface ParsedImportRow {
  title: string;
  authors: string[];
  isbn13: string | null;
  isbn10: string | null;
  asin: string | null;
  format: string | null;
  /** Paperback, hardcover, or no format given. Only physical copies count as owned. */
  physical: boolean;
  status: ReadingStatus | null;
  rating: number | null;
  /** Read dates as given (StoryGraph often has year only). */
  readDates: string[];
  owned: boolean;
}

/** A Hardcover book an import row matched or could match. */
export interface ImportCandidate {
  hcBookId: number;
  hcEditionId: number | null;
  title: string;
  authors: string[];
  year: number | null;
  imageUrl: string | null;
  readers: number;
}

/** A book's details from any source, for filling gaps and creating it on Hardcover. */
export interface BookDetails {
  title: string | null;
  subtitle: string | null;
  authors: string[];
  publisher: string | null;
  /** "1961" or "1961-04-01". */
  publishDate: string | null;
  pages: number | null;
  isbn13: string | null;
  isbn10: string | null;
  /** Shown here only; Hardcover needs an uploaded image id, so covers don't go up yet. */
  coverUrl: string | null;
}

export type BookDetailField = keyof BookDetails;
export type OpenLibraryStatus = "found" | "not_found" | "skipped";

/** Hardcover records a draft will be sent with, resolved before the "Add to Hardcover" click. */
export interface HardcoverPrep {
  authors: { name: string; id: number | null; hcName: string | null; books: number }[];
  publisher: { id: number; name: string } | null;
  preparedAt: string;
}

/** Per-field pick when the import and the library disagree. */
export type ImportChoice = "import" | "current";

export const imports = sqliteTable("imports", {
  id: id(),
  source: text("source").$type<ImportSource>().notNull(),
  filename: text("filename").notNull(),
  rowCount: integer("row_count").notNull().default(0),
  matched: integer("matched").notNull().default(0),
  unmatched: integer("unmatched").notNull().default(0),
  status: text("status").$type<ImportStatus>().notNull(),
  ...timestamps,
});

export const importRows = sqliteTable(
  "import_rows",
  {
    id: id(),
    importId: text("import_id")
      .notNull()
      .references(() => imports.id),
    raw: text("raw", { mode: "json" }).$type<Record<string, string>>().notNull(),
    matchStatus: text("match_status").$type<ImportMatchStatus>().notNull(),
    bookId: text("book_id").references(() => books.id),
    parsed: text("parsed", { mode: "json" }).$type<ParsedImportRow>(),
    matchSource: text("match_source").$type<ImportMatchSource>(),
    /** The Hardcover book this row goes to (null when matched to a local-only book or not matched). */
    match: text("match", { mode: "json" }).$type<ImportCandidate>(),
    candidates: text("candidates", { mode: "json" }).$type<ImportCandidate[]>(),
    choices: text("choices", { mode: "json" }).$type<Record<string, ImportChoice>>(),
    /** Why a row was skipped, in plain words. */
    note: text("note"),
    committedAt: text("committed_at"),
    /** What Open Library has for this row, when Hardcover didn't. */
    openLibrary: text("open_library", { mode: "json" }).$type<BookDetails>(),
    openLibraryStatus: text("open_library_status").$type<OpenLibraryStatus>(),
    /** The details that would go to Hardcover: the row's own, plus Open Library fields you accepted. */
    draft: text("draft", { mode: "json" }).$type<BookDetails>(),
    hardcoverPrep: text("hardcover_prep", { mode: "json" }).$type<HardcoverPrep>(),
    ...timestamps,
  },
  (t) => [index("import_rows_import_idx").on(t.importId)],
);

/** Small key-value store for one-time jobs and app settings. */
export const appMeta = sqliteTable("app_meta", {
  id: id(),
  key: text("key").notNull().unique(),
  value: text("value"),
  ...timestamps,
});

/** Responses from Open Library, so repeat lookups don't hit their servers again. */
export const openLibraryCache = sqliteTable("open_library_cache", {
  id: id(),
  key: text("key").notNull().unique(),
  payload: text("payload", { mode: "json" }).$type<unknown>(),
  fetchedAt: text("fetched_at").notNull(),
  ...timestamps,
});
