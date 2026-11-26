import Image from "next/image";
import Link from "next/link";
import type { LibraryRow } from "@/lib/library-rows";
import { publishedYear } from "@/lib/library-sort";
import { STATUS_INFO } from "@/lib/reading-status";

function Stars({ rating }: { rating: number | null }) {
    if (rating === null) return <span className="text-brand-faint">—</span>;
    return (
        <span className="text-status-paused" title={`${rating} of 5`}>
            {"★".repeat(Math.floor(rating))}
            {rating % 1 >= 0.5 ? "½" : ""}
        </span>
    );
}

/** The Library's book table. `ownedIds` is the Owned list, when it has synced. */
export function BookTable({ rows, ownedIds }: { rows: LibraryRow[]; ownedIds: Set<string> | null }) {
    return (
        <div className="overflow-hidden rounded-2xl border border-brand-line">
            <table className="w-full table-fixed text-left text-sm">
                <thead className="bg-brand-crust text-xs tracking-widest text-brand-muted uppercase">
                    <tr>
                        <th className="px-4 py-3 font-bold">Book</th>
                        <th className="w-36 px-4 py-3 font-bold">Status</th>
                        <th className="w-24 px-4 py-3 font-bold">Rating</th>
                        <th className="hidden w-20 px-4 py-3 font-bold sm:table-cell">Owned</th>
                        <th className="hidden w-28 px-4 py-3 font-bold md:table-cell">Published</th>
                        <th className="hidden w-28 px-4 py-3 font-bold md:table-cell">Added</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-brand-line bg-brand-surface">
                    {rows.map((row) => (
                        <tr key={row.id}>
                            <td className="px-4 py-3">
                                <Link href={`/books/${row.bookId}`} className="group flex items-center gap-3">
                                    {row.coverUrl ? (
                                        <Image
                                            src={row.coverUrl}
                                            alt=""
                                            width={40}
                                            height={60}
                                            className="h-15 w-10 shrink-0 rounded object-cover"
                                        />
                                    ) : (
                                        <div className="h-15 w-10 shrink-0 rounded bg-brand-line" />
                                    )}
                                    <div className="min-w-0">
                                        <p className="truncate font-bold group-hover:text-brand-accent">{row.title}</p>
                                        <p className="truncate text-brand-muted">
                                            {row.authors.join(", ") || "Unknown author"}
                                        </p>
                                    </div>
                                </Link>
                            </td>
                            <td className="px-4 py-3">
                                {row.status === null ? (
                                    <span className="text-xs text-brand-faint">No status</span>
                                ) : (
                                    <span
                                        className={`rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap ${STATUS_INFO[row.status].chipClass}`}
                                    >
                                        {STATUS_INFO[row.status].label}
                                    </span>
                                )}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                                <Stars rating={row.rating} />
                            </td>
                            <td className="hidden px-4 py-3 text-brand-muted sm:table-cell">
                                {(ownedIds ? ownedIds.has(row.bookId) : row.owned) ? "Yes" : ""}
                            </td>
                            <td className="hidden px-4 py-3 whitespace-nowrap text-brand-muted md:table-cell">
                                {publishedYear(row.published) ?? ""}
                            </td>
                            <td className="hidden px-4 py-3 whitespace-nowrap text-brand-muted md:table-cell">
                                {row.addedAt ?? ""}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
