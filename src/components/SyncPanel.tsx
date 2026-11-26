import { connection } from "next/server";
import { getSyncStatus } from "@/lib/sync/status";
import { summarizeStats } from "@/lib/sync/summary";
import { SyncControls } from "./SyncControls";

export async function SyncPanel() {
    await connection();
    const status = getSyncStatus();
    const last = status.lastRun;

    let lastMessage: string | null = null;
    if (last?.error) lastMessage = last.error;
    else if (last?.stats) lastMessage = summarizeStats(last.stats);

    return (
        <SyncControls
            running={status.running}
            autoSyncDue={status.autoSyncDue}
            lastMessage={lastMessage}
            lastFailed={Boolean(last?.error)}
            lastWouldRemove={last?.errorDetail?.wouldRemove ?? null}
        />
    );
}
