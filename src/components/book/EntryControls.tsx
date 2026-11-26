"use client";

import { useState } from "react";
import { setHidden, setOwned, setRating, setStatus } from "@/app/actions/library";
import type { ReadingStatus } from "@/db/schema";
import { useInstantEdit } from "./use-instant-edit";

export interface StatusOption {
    value: ReadingStatus;
    label: string;
    chipClass: string;
}

interface Props {
    entryId: string;
    status: ReadingStatus;
    rating: number | null;
    owned: boolean;
    hidden: boolean;
    statusOptions: StatusOption[];
}

function ErrorText({ error }: { error: string | null }) {
    return error ? <p className="text-sm text-status-dnf">{error}</p> : null;
}

function StatusPicker({ entryId, status, options }: { entryId: string; status: ReadingStatus; options: StatusOption[] }) {
    const edit = useInstantEdit(status, (next: ReadingStatus) => setStatus(entryId, next));
    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Reading status">
                {options.map((option) => {
                    const active = option.value === edit.value;
                    return (
                        <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => !active && edit.change(option.value)}
                            className={
                                active
                                    ? `rounded-full px-3 py-1 text-sm font-bold ring-2 ring-current ${option.chipClass}`
                                    : "rounded-full border border-brand-line px-3 py-1 text-sm text-brand-muted hover:text-brand-text"
                            }
                        >
                            {option.label}
                        </button>
                    );
                })}
            </div>
            <ErrorText error={edit.error} />
        </div>
    );
}

const STARS = [1, 2, 3, 4, 5] as const;

function fillClass(star: number, rating: number): string {
    if (rating >= star) return "w-full";
    if (rating >= star - 0.5) return "w-1/2";
    return "w-0";
}

function StarRating({ entryId, rating }: { entryId: string; rating: number | null }) {
    const edit = useInstantEdit(rating, (next: number | null) => setRating(entryId, next));
    const [hover, setHover] = useState<number | null>(null);
    const shown = hover ?? edit.value ?? 0;

    // Clicking the current rating again clears it.
    const pick = (value: number) => edit.change(value === edit.value ? null : value);

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
                <div className="flex" onMouseLeave={() => setHover(null)}>
                    {STARS.map((star) => (
                        <span key={star} className="relative block size-8 text-3xl leading-8">
                            <span className="text-brand-line-strong">★</span>
                            <span
                                className={`absolute inset-y-0 left-0 overflow-hidden text-status-paused ${fillClass(star, shown)}`}
                            >
                                ★
                            </span>
                            {[star - 0.5, star].map((value, half) => (
                                <button
                                    key={value}
                                    type="button"
                                    aria-label={`Rate ${value} stars`}
                                    onMouseEnter={() => setHover(value)}
                                    onFocus={() => setHover(value)}
                                    onBlur={() => setHover(null)}
                                    onClick={() => pick(value)}
                                    className={`absolute inset-y-0 w-1/2 cursor-pointer ${half === 0 ? "left-0" : "right-0"}`}
                                />
                            ))}
                        </span>
                    ))}
                </div>
                <span className="text-sm text-brand-muted">
                    {edit.value === null ? "Not rated" : `${edit.value} / 5`}
                </span>
            </div>
            <ErrorText error={edit.error} />
        </div>
    );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className="flex items-center gap-3 text-sm"
        >
            <span
                className={`flex h-6 w-11 items-center rounded-full p-0.5 transition ${checked ? "justify-end bg-brand-accent" : "justify-start bg-brand-line-strong"}`}
            >
                <span className="size-5 rounded-full bg-brand-text" />
            </span>
            {label}
        </button>
    );
}

function OwnedSwitch({ entryId, owned }: { entryId: string; owned: boolean }) {
    const edit = useInstantEdit(owned, (next: boolean) => setOwned(entryId, next));
    return (
        <div className="flex flex-col gap-1">
            <Switch checked={edit.value} onChange={edit.change} label="I own a copy" />
            <ErrorText error={edit.error} />
        </div>
    );
}

function HideButton({ entryId, hidden }: { entryId: string; hidden: boolean }) {
    const edit = useInstantEdit(hidden, (next: boolean) => setHidden(entryId, next));
    return (
        <div className="flex flex-col gap-1">
            <button
                type="button"
                onClick={() => edit.change(!edit.value)}
                className="self-start rounded-full border border-brand-line px-3 py-1 text-sm text-brand-muted hover:text-brand-text"
            >
                {edit.value ? "Unhide" : "Hide from my library"}
            </button>
            <p className="text-xs text-brand-faint">
                {edit.value
                    ? "Hidden here only. It's still on Hardcover."
                    : "Hiding only affects this app. Nothing changes on Hardcover."}
            </p>
            <ErrorText error={edit.error} />
        </div>
    );
}

export function EntryControls({ entryId, status, rating, owned, hidden, statusOptions }: Props) {
    return (
        <div className="flex flex-col gap-5">
            <StatusPicker entryId={entryId} status={status} options={statusOptions} />
            <StarRating entryId={entryId} rating={rating} />
            <OwnedSwitch entryId={entryId} owned={owned} />
            <HideButton entryId={entryId} hidden={hidden} />
        </div>
    );
}
