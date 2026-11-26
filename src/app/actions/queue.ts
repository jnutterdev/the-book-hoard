"use server";

import { refresh } from "next/cache";
import type { ConflictResolution } from "@/db/schema";
import { enablePush } from "@/lib/sync/push";
import { approveOutboxRow, discardOutboxRow, resolveConflictRow, retryOutboxRow } from "@/lib/sync/queue";
import { syncNow, type SyncResult } from "./sync";

export type QueueResult = { ok: true } | { ok: false; error: string };

function run(work: () => void): QueueResult {
    try {
        work();
        refresh();
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Something went wrong" };
    }
}

/** Turns pushing on for good and sends what's waiting right away. */
export async function startSending(): Promise<SyncResult> {
    enablePush();
    return syncNow();
}

export async function approveChange(id: string): Promise<QueueResult> {
    return run(() => approveOutboxRow(id));
}

export async function retryChange(id: string): Promise<QueueResult> {
    return run(() => retryOutboxRow(id));
}

export async function discardChange(id: string): Promise<QueueResult> {
    return run(() => discardOutboxRow(id));
}

export async function resolveConflict(id: string, resolution: ConflictResolution): Promise<QueueResult> {
    if (resolution !== "local" && resolution !== "remote") return { ok: false, error: "Unknown choice" };
    return run(() => resolveConflictRow(id, resolution));
}
