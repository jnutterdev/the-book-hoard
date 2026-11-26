import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { syncConflicts, syncOutbox, type OutboxOp, type SyncedEntity } from "@/db/schema";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const pendingRow = and(eq(syncOutbox.status, "pending"), isNull(syncOutbox.deletedAt));

function pendingFor(tx: Tx, entityType: SyncedEntity, entityId: string) {
    return tx
        .select()
        .from(syncOutbox)
        .where(and(pendingRow, eq(syncOutbox.entityType, entityType), eq(syncOutbox.entityId, entityId)))
        .all();
}

/**
 * Records a local change to push to Hardcover. Call it inside the same
 * transaction as the change itself. Repeated updates to one record merge into a
 * single row, and a delete of something never pushed cancels its create.
 *
 * `baseValues` holds each field's value before this edit. Only the first edit's
 * base is kept, since that's the last value Hardcover is known to have had.
 */
export function enqueue(
    tx: Tx,
    entityType: SyncedEntity,
    entityId: string,
    op: OutboxOp,
    changedFields: string[] = [],
    baseValues: Record<string, unknown> = {},
): void {
    const pending = pendingFor(tx, entityType, entityId);
    const now = new Date().toISOString();

    if (op === "update") {
        const existing = pending.find((row) => row.op === "update" || row.op === "create");
        if (existing) {
            if (existing.op === "update") {
                const merged = [...new Set([...existing.changedFields, ...changedFields])];
                const bases = { ...baseValues, ...(existing.baseValues ?? {}) };
                tx.update(syncOutbox)
                    .set({ changedFields: merged, baseValues: bases })
                    .where(eq(syncOutbox.id, existing.id))
                    .run();
            }
            // A pending create already sends the whole record.
            return;
        }
    }

    if (op === "delete") {
        const create = pending.find((row) => row.op === "create");
        if (create) {
            // Never reached Hardcover, so there's nothing to delete there.
            const ids = pending.map((row) => row.id);
            tx.update(syncOutbox).set({ deletedAt: now }).where(inArray(syncOutbox.id, ids)).run();
            return;
        }
        const updates = pending.filter((row) => row.op === "update").map((row) => row.id);
        if (updates.length > 0) {
            tx.update(syncOutbox).set({ deletedAt: now }).where(inArray(syncOutbox.id, updates)).run();
        }
    }

    if (op === "create") {
        const deletion = pending.find((row) => row.op === "delete");
        if (deletion) {
            // Re-adding something whose removal hasn't been pushed: the two cancel out.
            tx.update(syncOutbox).set({ deletedAt: now }).where(eq(syncOutbox.id, deletion.id)).run();
            return;
        }
    }

    tx.insert(syncOutbox).values({ entityType, entityId, op, changedFields, baseValues }).run();
}

/** Fields with an unsent local edit or an open conflict, so a pull knows not to overwrite them. */
export function pendingFields(tx: Tx, entityType: SyncedEntity, entityId: string): Set<string> {
    const fields = new Set<string>();
    for (const row of pendingFor(tx, entityType, entityId)) {
        for (const field of row.changedFields) fields.add(field);
    }
    const conflicts = tx
        .select({ field: syncConflicts.field })
        .from(syncConflicts)
        .where(
            and(
                eq(syncConflicts.entityType, entityType),
                eq(syncConflicts.entityId, entityId),
                isNull(syncConflicts.resolvedAt),
                isNull(syncConflicts.deletedAt),
            ),
        )
        .all();
    for (const conflict of conflicts) fields.add(conflict.field);
    return fields;
}

/** Local ids of records of this type with any unsent change. */
export function pendingEntityIds(tx: Tx, entityType: SyncedEntity): Set<string> {
    const rows = tx
        .select({ entityId: syncOutbox.entityId })
        .from(syncOutbox)
        .where(and(pendingRow, eq(syncOutbox.entityType, entityType)))
        .all();
    return new Set(rows.map((row) => row.entityId));
}

export function hasPendingChanges(entityType: SyncedEntity, entityIds: string[]): boolean {
    if (entityIds.length === 0) return false;
    const row = db
        .select({ id: syncOutbox.id })
        .from(syncOutbox)
        .where(and(pendingRow, eq(syncOutbox.entityType, entityType), inArray(syncOutbox.entityId, entityIds)))
        .get();
    return row !== undefined;
}
