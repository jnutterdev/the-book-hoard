"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { uploadStoryGraph } from "@/app/actions/import";

export function UploadForm() {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    return (
        <form
            className="flex flex-col gap-3 rounded-2xl border border-brand-line bg-brand-surface p-4"
            action={(formData) =>
                startTransition(async () => {
                    setError(null);
                    const result = await uploadStoryGraph(formData);
                    if (result.ok) router.push(`/import/${result.importId}`);
                    else setError(result.error);
                })
            }
        >
            <label className="flex flex-col gap-2">
                <span className="font-bold">StoryGraph export (.csv)</span>
                <input
                    type="file"
                    name="file"
                    accept=".csv,text/csv"
                    required
                    disabled={pending}
                    className="text-sm text-brand-soft file:mr-3 file:rounded-full file:border-0 file:bg-brand-line file:px-3 file:py-1 file:font-bold file:text-brand-text"
                />
            </label>
            <div className="flex items-center gap-3">
                <button
                    type="submit"
                    disabled={pending}
                    className="rounded-full bg-brand-accent px-4 py-1.5 font-bold text-brand-crust transition hover:bg-brand-accent-alt disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {pending ? "Matching…" : "Upload and match"}
                </button>
                {pending ? (
                    <span className="flex items-center gap-2 text-sm text-brand-muted" role="status">
                        <span className="size-3.5 animate-spin rounded-full border-2 border-brand-line-strong border-t-brand-accent" />
                        Looking books up on Hardcover. This can take a minute.
                    </span>
                ) : null}
            </div>
            {error ? <p className="text-sm text-status-dnf">{error}</p> : null}
            <p className="text-sm text-brand-faint">
                Nothing changes until you review the matches and hit Import. Your file stays on this computer.
            </p>
        </form>
    );
}
