import Link from "next/link";
import { SORT_OPTIONS, sortHref, type SortDir, type SortKey } from "@/lib/library-sort";

interface Props {
    path: string;
    /** Filter params to keep on every link. */
    params: Record<string, string>;
    sort: { key: SortKey; dir: SortDir };
}

export function SortLinks({ path, params, sort }: Props) {
    return (
        <nav aria-label="Sort" className="flex flex-wrap items-center gap-1 text-sm">
            <span className="mr-1 text-brand-muted">Sort</span>
            {SORT_OPTIONS.map((option) => {
                const isActive = option.key === sort.key;
                // Clicking the active sort flips it; any other starts at its own default.
                const dir: SortDir = isActive ? (sort.dir === "asc" ? "desc" : "asc") : option.defaultDir;
                return (
                    <Link
                        key={option.key}
                        href={sortHref(path, params, { key: option.key, dir })}
                        aria-current={isActive ? "true" : undefined}
                        className={
                            isActive
                                ? "rounded-full bg-brand-line/60 px-2.5 py-0.5 font-bold text-brand-text"
                                : "rounded-full px-2.5 py-0.5 text-brand-muted hover:text-brand-text"
                        }
                    >
                        {option.label}
                        {isActive ? <span aria-hidden="true"> {sort.dir === "asc" ? "↑" : "↓"}</span> : null}
                    </Link>
                );
            })}
        </nav>
    );
}
