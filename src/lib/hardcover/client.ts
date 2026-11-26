import "server-only";

import { log } from "@/lib/log";
import { RateLimiter, retryAfterMs, sleep } from "./rate-limiter";

const ENDPOINT = "https://api.hardcover.app/v1/graphql";
const USER_AGENT = "TheBookHoard/0.1 (personal library sync)";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 4;

export type HardcoverErrorKind =
    | "missing_token"
    | "unauthorized"
    | "rate_limited"
    | "network"
    | "http"
    | "graphql";

export interface GraphQLErrorItem {
    message: string;
    path?: (string | number)[];
    extensions?: { code?: string } & Record<string, unknown>;
}

interface GraphQLResponse<TData> {
    data?: TData | null;
    errors?: GraphQLErrorItem[];
}

export class HardcoverError extends Error {
    readonly kind: HardcoverErrorKind;
    readonly status?: number;
    readonly graphqlErrors?: GraphQLErrorItem[];
    /** ISO time the daily quota resets, when that's why we stopped. */
    readonly resetsAt?: string;

    constructor(
        kind: HardcoverErrorKind,
        message: string,
        options: { status?: number; graphqlErrors?: GraphQLErrorItem[]; resetsAt?: string; cause?: unknown } = {},
    ) {
        super(message, { cause: options.cause });
        this.name = "HardcoverError";
        this.kind = kind;
        this.status = options.status;
        this.graphqlErrors = options.graphqlErrors;
        this.resetsAt = options.resetsAt;
    }
}

type Variables = Record<string, unknown>;

/** Hardcover's settings page shows the token with a `Bearer ` prefix; accept it either way. */
function readToken(): string | null {
    const raw = process.env.HARDCOVER_API_KEY?.trim();
    if (!raw) return null;
    return raw.replace(/^Bearer\s+/i, "");
}

// One limiter per process, kept across dev hot reloads so edits don't reset the budget.
const globalForHardcover = globalThis as typeof globalThis & { hardcoverLimiter?: RateLimiter };
const limiter = globalForHardcover.hardcoverLimiter ?? new RateLimiter(10, 1);
globalForHardcover.hardcoverLimiter = limiter;

const backoffMs = (attempt: number): number => 500 * 2 ** (attempt - 1);

const AUTH_ERROR_CODES = new Set(["invalid-jwt", "invalid-headers", "access-denied"]);

/**
 * Sends one GraphQL operation. Remember that each top-level field in `query`
 * counts as one request against the rate limit; nested selections are free.
 * Throws `HardcoverError` for every failure, including 200s that carry `errors`.
 */
export async function hardcoverRequest<TData, TVariables extends Variables = Variables>(
    query: string,
    variables?: TVariables,
): Promise<TData> {
    const token = readToken();
    if (!token) {
        throw new HardcoverError("missing_token", "HARDCOVER_API_KEY is not set");
    }

    for (let attempt = 1; ; attempt++) {
        const allowed = await limiter.acquire();
        if (!allowed) {
            const resetsAt = limiter.dailyResetsAt?.toISOString();
            throw new HardcoverError("rate_limited", `Daily Hardcover quota used up; resets ${resetsAt ?? "later"}`, {
                resetsAt,
            });
        }

        let response: Response;
        try {
            response = await fetch(ENDPOINT, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "user-agent": USER_AGENT,
                    authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ query, variables }),
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
        } catch (cause) {
            if (attempt < MAX_ATTEMPTS) {
                void log.warn("Hardcover request failed, retrying", { attempt }, cause);
                await sleep(backoffMs(attempt));
                continue;
            }
            throw new HardcoverError("network", "Could not reach Hardcover", { cause });
        }

        limiter.observe(response.headers);

        if (response.status === 401 || response.status === 403) {
            throw new HardcoverError("unauthorized", await describeHttpError(response), {
                status: response.status,
            });
        }

        if (response.status === 429) {
            const waitMs = retryAfterMs(response.headers) ?? backoffMs(attempt);
            limiter.pauseFor(waitMs);
            void log.warn("Hardcover rate limited us", { attempt, waitMs });
            if (attempt < MAX_ATTEMPTS) continue;
            throw new HardcoverError("rate_limited", "Hardcover kept rate limiting us", { status: 429 });
        }

        if (response.status >= 500 && attempt < MAX_ATTEMPTS) {
            void log.warn("Hardcover server error, retrying", { attempt, status: response.status });
            await sleep(backoffMs(attempt));
            continue;
        }

        if (!response.ok) {
            throw new HardcoverError("http", await describeHttpError(response), {
                status: response.status,
            });
        }

        const body = (await response.json()) as GraphQLResponse<TData>;

        if (body.errors?.length) {
            const kind = body.errors.some((e) => AUTH_ERROR_CODES.has(e.extensions?.code ?? ""))
                ? "unauthorized"
                : "graphql";
            throw new HardcoverError(kind, body.errors.map((e) => e.message).join("; "), {
                status: response.status,
                graphqlErrors: body.errors,
            });
        }

        if (body.data == null) {
            throw new HardcoverError("graphql", "Hardcover returned no data", { status: response.status });
        }

        return body.data;
    }
}

async function describeHttpError(response: Response): Promise<string> {
    const text = await response.text().catch(() => "");
    try {
        const parsed = JSON.parse(text) as { error_description?: string; error?: string };
        return parsed.error_description ?? parsed.error ?? `HTTP ${response.status}`;
    } catch {
        return text.slice(0, 200) || `HTTP ${response.status}`;
    }
}
