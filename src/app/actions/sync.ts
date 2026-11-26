"use server";

import { refresh } from "next/cache";
import type { SyncErrorDetail } from "@/db/schema";
import { runPull, type SyncOutcome } from "@/lib/sync/pull";
import { getSyncStatus } from "@/lib/sync/status";
import { summarizeStats } from "@/lib/sync/summary";

export type SyncResult =
    | { state: "ok"; summary: string }
    | { state: "busy" }
    | { state: "error"; message: string; wouldRemove?: SyncErrorDetail["wouldRemove"] }
    | { state: "skipped" };

function toResult(outcome: SyncOutcome): SyncResult {
    switch (outcome.status) {
        case "ok":
            return { state: "ok", summary: summarizeStats(outcome.stats) };
        case "busy":
            return { state: "busy" };
        case "failed":
            return { state: "error", message: outcome.message, wouldRemove: outcome.detail.wouldRemove };
    }
}

export async function syncNow(options: { confirmDeletions?: boolean } = {}): Promise<SyncResult> {
    const outcome = await runPull({ trigger: "manual", confirmDeletions: options.confirmDeletions === true });
    refresh();
    return toResult(outcome);
}

/** Called once when the app opens. Only syncs if the last good sync is stale and nothing says to wait. */
export async function autoSync(): Promise<SyncResult> {
    if (!getSyncStatus().autoSyncDue) return { state: "skipped" };
    const outcome = await runPull({ trigger: "auto" });
    refresh();
    return toResult(outcome);
}
