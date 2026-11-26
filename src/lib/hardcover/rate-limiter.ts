const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Client-side token bucket that mirrors Hardcover's limits (60/min, burst of 10)
 * so we wait locally instead of collecting 429s. Response headers correct it
 * when the server's count disagrees with ours.
 */
export class RateLimiter {
    private tokens: number;
    private lastRefill = Date.now();
    private pausedUntil = 0;
    private dailyExhaustedUntil = 0;

    constructor(
        private readonly capacity: number,
        private readonly refillPerSecond: number,
    ) {
        this.tokens = capacity;
    }

    /** Resolves when a request may be sent. Returns false if the daily quota is spent. */
    async acquire(): Promise<boolean> {
        for (;;) {
            const now = Date.now();
            if (now < this.dailyExhaustedUntil) return false;
            if (now < this.pausedUntil) {
                await sleep(this.pausedUntil - now);
                continue;
            }
            this.refill(now);
            if (this.tokens >= 1) {
                this.tokens -= 1;
                return true;
            }
            await sleep(Math.ceil(((1 - this.tokens) / this.refillPerSecond) * 1000));
        }
    }

    pauseFor(ms: number): void {
        this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
        this.tokens = 0;
    }

    /** Reads Hardcover's `x-ratelimit-*` headers from a response. */
    observe(headers: Headers): void {
        const remaining = readNumber(headers, "x-ratelimit-remaining");
        if (remaining !== null) {
            this.refill(Date.now());
            this.tokens = Math.min(this.tokens, remaining);
            const resetAt = readNumber(headers, "x-ratelimit-reset");
            if (remaining <= 0 && resetAt !== null) {
                this.pausedUntil = Math.max(this.pausedUntil, resetAt * 1000);
            }
        }

        const dailyRemaining = readNumber(headers, "x-ratelimit-daily-remaining");
        const dailyResetAt = readNumber(headers, "x-ratelimit-daily-reset");
        if (dailyRemaining !== null && dailyRemaining <= 0 && dailyResetAt !== null) {
            this.dailyExhaustedUntil = dailyResetAt * 1000;
        }
    }

    get dailyResetsAt(): Date | null {
        return this.dailyExhaustedUntil > Date.now() ? new Date(this.dailyExhaustedUntil) : null;
    }

    private refill(now: number): void {
        const elapsedSeconds = (now - this.lastRefill) / 1000;
        this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
        this.lastRefill = now;
    }
}

function readNumber(headers: Headers, name: string): number | null {
    const raw = headers.get(name);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
}

/** `Retry-After` is either delay-seconds or an HTTP date. */
export function retryAfterMs(headers: Headers): number | null {
    const raw = headers.get("retry-after");
    if (raw === null) return null;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(raw);
    return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

export { sleep };
