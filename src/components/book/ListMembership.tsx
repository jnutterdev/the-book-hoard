"use client";

import Link from "next/link";
import { setOnList } from "@/app/actions/library";
import { useInstantEdit } from "./use-instant-edit";

interface ListOption {
    id: string;
    name: string;
    onList: boolean;
}

function ListCheckbox({ bookId, list }: { bookId: string; list: ListOption }) {
    const edit = useInstantEdit(list.onList, (next: boolean) => setOnList(bookId, list.id, next));
    return (
        <li className="flex flex-col gap-1">
            <label className="flex cursor-pointer items-center gap-3">
                <input
                    type="checkbox"
                    checked={edit.value}
                    onChange={(event) => edit.change(event.target.checked)}
                    className="size-4 accent-brand-accent"
                />
                <span>{list.name}</span>
            </label>
            {edit.error ? <p className="text-sm text-status-dnf">{edit.error}</p> : null}
        </li>
    );
}

export function ListMembership({ bookId, lists }: { bookId: string; lists: ListOption[] }) {
    if (lists.length === 0) {
        return (
            <p className="text-sm text-brand-muted">
                No lists yet. Lists you make on Hardcover show up here after a <Link href="/sync" className="underline">sync</Link>.
            </p>
        );
    }
    return (
        <ul className="flex flex-col gap-2">
            {lists.map((list) => (
                <ListCheckbox key={list.id} bookId={bookId} list={list} />
            ))}
        </ul>
    );
}
