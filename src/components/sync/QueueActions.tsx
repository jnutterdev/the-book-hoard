"use client";

import { useState, useTransition } from "react";
import {
    approveChange,
    discardChange,
    resolveConflict,
    retryChange,
    startSending,
    type QueueResult,
} from "@/app/actions/queue";

const PRIMARY =
    "rounded-full bg-brand-accent px-3 py-1 text-sm font-bold text-brand-crust transition hover:bg-brand-accent-alt disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY =
    "rounded-full border border-brand-line-strong px-3 py-1 text-sm font-bold text-brand-soft transition hover:bg-brand-line/40 disabled:cursor-not-allowed disabled:opacity-50";

interface Choice {
    label: string;
    primary?: boolean;
    act: () => Promise<QueueResult>;
}

function Choices({ choices }: { choices: Choice[] }) {
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    return (
        <div className="flex flex-col items-end gap-1">
            <div className="flex gap-2">
                {choices.map((choice) => (
                    <button
                        key={choice.label}
                        type="button"
                        disabled={pending}
                        className={choice.primary ? PRIMARY : SECONDARY}
                        onClick={() =>
                            startTransition(async () => {
                                const result = await choice.act();
                                setError(result.ok ? null : result.error);
                            })
                        }
                    >
                        {choice.label}
                    </button>
                ))}
            </div>
            {error ? <p className="text-xs text-status-dnf">{error}</p> : null}
        </div>
    );
}

export function ApprovalChoices({ id }: { id: string }) {
    return (
        <Choices
            choices={[
                { label: "Approve", primary: true, act: () => approveChange(id) },
                { label: "Discard", act: () => discardChange(id) },
            ]}
        />
    );
}

export function FailedChoices({ id }: { id: string }) {
    return (
        <Choices
            choices={[
                { label: "Retry", primary: true, act: () => retryChange(id) },
                { label: "Discard", act: () => discardChange(id) },
            ]}
        />
    );
}

export function DiscardChoice({ id }: { id: string }) {
    return <Choices choices={[{ label: "Discard", act: () => discardChange(id) }]} />;
}

export function ConflictChoices({ id }: { id: string }) {
    return (
        <Choices
            choices={[
                { label: "Keep mine", primary: true, act: () => resolveConflict(id, "local") },
                { label: "Keep theirs", act: () => resolveConflict(id, "remote") },
            ]}
        />
    );
}

export function StartSendingButton({ count }: { count: number }) {
    const [pending, startTransition] = useTransition();
    const [message, setMessage] = useState<string | null>(null);

    return (
        <div className="flex flex-col items-start gap-2">
            <button
                type="button"
                disabled={pending}
                className={PRIMARY}
                onClick={() =>
                    startTransition(async () => {
                        const result = await startSending();
                        if (result.state === "ok") setMessage(result.summary);
                        else if (result.state === "error") setMessage(result.message);
                        else if (result.state === "busy") setMessage("A sync is already running; it'll send on the next one.");
                    })
                }
            >
                {pending ? "Sending…" : `Start sending to Hardcover (${count})`}
            </button>
            {message ? <p className="text-sm text-brand-muted">{message}</p> : null}
        </div>
    );
}
