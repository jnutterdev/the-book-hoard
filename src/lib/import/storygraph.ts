import { parse } from "csv-parse/sync";
import { z } from "zod";
import { READING_STATUS, type ParsedImportRow, type ReadingStatus } from "@/db/schema";
import { parseBookId } from "./isbn";

const STATUS_MAP: Record<string, ReadingStatus> = {
    read: READING_STATUS.read,
    "currently-reading": READING_STATUS.reading,
    "to-read": READING_STATUS.wantToRead,
    paused: READING_STATUS.paused,
    "did-not-finish": READING_STATUS.didNotFinish,
};

const PHYSICAL_FORMATS = new Set(["paperback", "hardcover", ""]);

const text = z.string().optional().default("");

/** The StoryGraph columns this app reads. Others (moods, pace, …) are kept in `raw` only. */
const storyGraphRow = z.object({
    Title: z.string().trim().min(1, "Row has no title"),
    Authors: text,
    "ISBN/UID": text,
    Format: text,
    "Read Status": text,
    "Star Rating": text,
    "Last Date Read": text,
    "Dates Read": text,
    "Owned?": text,
});

export const STORYGRAPH_REQUIRED_COLUMNS = ["Title", "Authors", "ISBN/UID", "Read Status", "Owned?"];

export interface ParseResult {
    rows: { raw: Record<string, string>; parsed: ParsedImportRow | null; error: string | null }[];
}

function splitList(value: string): string[] {
    return value
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
}

/** StoryGraph uses quarter stars; Hardcover takes halves. */
function toRating(value: string): number | null {
    const n = Number.parseFloat(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.min(5, Math.max(0.5, Math.round(n * 2) / 2));
}

/** "2026/07/03" → "2026-07-03"; "2026" stays "2026". */
function toDate(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.replace(/\//g, "-");
}

function readDates(row: z.infer<typeof storyGraphRow>): string[] {
    // "Dates Read" looks like "2025/01/02-2025/02/01, 2026" (ranges or single dates, comma separated).
    const dates = splitList(row["Dates Read"])
        .map((part) => toDate(part.split("-").pop() ?? part))
        .filter((date): date is string => date !== null);
    const last = toDate(row["Last Date Read"]);
    if (dates.length === 0 && last) dates.push(last);
    return [...new Set(dates)];
}

export function parseStoryGraphCsv(csv: string): ParseResult {
    const records = parse(csv, { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true }) as Record<
        string,
        string
    >[];
    const header = records[0] ? Object.keys(records[0]) : [];
    const missing = STORYGRAPH_REQUIRED_COLUMNS.filter((column) => !header.includes(column));
    if (records.length > 0 && missing.length > 0) {
        throw new Error(`This doesn't look like a StoryGraph export (missing ${missing.join(", ")})`);
    }

    return {
        rows: records.map((raw) => {
            const result = storyGraphRow.safeParse(raw);
            if (!result.success) {
                return { raw, parsed: null, error: result.error.issues[0]?.message ?? "Couldn't read this row" };
            }
            const row = result.data;
            const format = row.Format.trim().toLowerCase();
            const parsed: ParsedImportRow = {
                title: row.Title.trim(),
                authors: splitList(row.Authors),
                ...parseBookId(row["ISBN/UID"]),
                format: format || null,
                physical: PHYSICAL_FORMATS.has(format),
                status: STATUS_MAP[row["Read Status"].trim().toLowerCase()] ?? null,
                rating: toRating(row["Star Rating"]),
                readDates: readDates(row),
                owned: row["Owned?"].trim().toLowerCase() === "yes",
            };
            return { raw, parsed, error: null };
        }),
    };
}
