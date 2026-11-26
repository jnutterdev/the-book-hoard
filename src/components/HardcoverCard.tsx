import Image from "next/image";
import { connection } from "next/server";
import { checkHardcoverConnection, type HardcoverConnection } from "@/lib/hardcover/me";

interface CardContent {
    headline: string;
    detail: string;
    art: "syncing" | "complete";
}

const ART = {
    syncing: { src: "/art/robot-syncing.png", alt: "a robot with a syncing image", width: 120, height: 101 },
    complete: { src: "/art/robot-sync-complete.png", alt: "a robot celebrating a finished sync", width: 120, height: 116 },
} as const;

function describe(connectionState: HardcoverConnection): CardContent {
    if (connectionState.state === "connected") {
        return {
            headline: `Connected as @${connectionState.user.username}`,
            detail: "The sync robot can reach your Hardcover library.",
            art: "complete",
        };
    }

    switch (connectionState.kind) {
        case "missing_token":
            return {
                headline: "No API key",
                detail: "Add HARDCOVER_API_KEY to Doppler (library-tracker / dev_personal), then restart pnpm dev.",
                art: "syncing",
            };
        case "unauthorized":
            return {
                headline: "Key rejected",
                detail: "Hardcover tokens expire. Make a new one in your Hardcover account settings and update Doppler.",
                art: "syncing",
            };
        case "rate_limited":
            return { headline: "Taking a breather", detail: connectionState.message, art: "syncing" };
        default:
            return { headline: "Hardcover isn't answering", detail: connectionState.message, art: "syncing" };
    }
}

function CardShell({ headline, detail, art }: CardContent) {
    const image = ART[art];
    return (
        <section className="flex items-center justify-between gap-6 rounded-2xl border border-brand-line bg-brand-surface p-6">
            <div className="flex flex-col gap-2">
                <h2 className="text-sm font-bold tracking-widest text-brand-muted uppercase">Hardcover</h2>
                <p className="text-lg font-bold">{headline}</p>
                <p className="text-brand-muted">{detail}</p>
            </div>
            <Image
                src={image.src}
                alt={image.alt}
                width={image.width}
                height={image.height}
                loading="eager"
                className="h-auto w-16"
            />
        </section>
    );
}

export async function HardcoverCard() {
    // Without this, the missing-token branch never fetches and would be prerendered at build.
    await connection();
    const content = describe(await checkHardcoverConnection());
    return <CardShell {...content} />;
}

export function HardcoverCardFallback() {
    return <CardShell headline="Checking…" detail="Knocking on Hardcover's door." art="syncing" />;
}
