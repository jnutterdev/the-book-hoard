import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { SyncPanel } from "./SyncPanel";

const NAV = [
    { href: "/", label: "Home" },
    { href: "/library", label: "Library" },
    { href: "/lists", label: "Lists" },
    { href: "/import", label: "Import" },
    { href: "/sync", label: "Sync" },
] as const;

export function SiteHeader() {
    return (
        <header className="border-b border-brand-line bg-brand-crust/60">
            <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-3">
                <nav className="flex items-center gap-6">
                    <Link href="/" className="flex items-center gap-2 font-extrabold">
                        <Image src="/art/dragon-head.png" alt="" width={32} height={30} className="h-auto w-8" />
                        The Book Hoard
                    </Link>
                    {NAV.map((item) => (
                        <Link key={item.href} href={item.href} className="text-brand-muted hover:text-brand-text">
                            {item.label}
                        </Link>
                    ))}
                </nav>
                <Suspense fallback={null}>
                    <SyncPanel />
                </Suspense>
            </div>
        </header>
    );
}
