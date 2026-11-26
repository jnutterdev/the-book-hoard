import { READING_STATUS, type ReadingStatus } from "@/db/schema";

interface StatusInfo {
    label: string;
    /** Full class names, so Tailwind can see them. */
    chipClass: string;
}

export const STATUS_INFO: Record<ReadingStatus, StatusInfo> = {
    [READING_STATUS.wantToRead]: { label: "Want to read", chipClass: "bg-status-want/15 text-status-want" },
    [READING_STATUS.reading]: { label: "Reading", chipClass: "bg-status-reading/15 text-status-reading" },
    [READING_STATUS.read]: { label: "Read", chipClass: "bg-status-read/15 text-status-read" },
    [READING_STATUS.paused]: { label: "Paused", chipClass: "bg-status-paused/15 text-status-paused" },
    [READING_STATUS.didNotFinish]: { label: "Did not finish", chipClass: "bg-status-dnf/15 text-status-dnf" },
    [READING_STATUS.ignored]: { label: "Ignored", chipClass: "bg-status-ignored/15 text-status-ignored" },
};

export const STATUS_ORDER: ReadingStatus[] = [
    READING_STATUS.reading,
    READING_STATUS.wantToRead,
    READING_STATUS.read,
    READING_STATUS.paused,
    READING_STATUS.didNotFinish,
    READING_STATUS.ignored,
];

export function parseStatus(value: string | undefined): ReadingStatus | null {
    const n = Number(value);
    return STATUS_ORDER.find((status) => status === n) ?? null;
}
