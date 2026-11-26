"use client";

import { useOptimistic, useState, useTransition } from "react";
import type { EditResult } from "@/app/actions/library";

/**
 * Shows a new value right away, saves it with a server action, and rolls back
 * (with a message) if the save fails.
 */
export function useInstantEdit<T>(serverValue: T, save: (value: T) => Promise<EditResult>) {
    const [value, setOptimistic] = useOptimistic(serverValue);
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    const change = (next: T) =>
        startTransition(async () => {
            setOptimistic(next);
            const result = await save(next);
            setError(result.ok ? null : result.error);
        });

    return { value, change, pending, error };
}
