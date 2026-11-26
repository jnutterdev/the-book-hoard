import "server-only";

import { HardcoverError, hardcoverRequest } from "./client";

export interface HardcoverUser {
    id: number;
    username: string;
}

const ME_QUERY = /* GraphQL */ `
    query Me {
        me {
            id
            username
        }
    }
`;

/** `me` is a list on Hardcover; a valid token always yields exactly one user. */
export async function getMe(): Promise<HardcoverUser> {
    const data = await hardcoverRequest<{ me: HardcoverUser[] }>(ME_QUERY);
    const [user] = data.me;
    if (!user) {
        throw new HardcoverError("unauthorized", "Token is not associated with a user");
    }
    return user;
}

export type HardcoverConnection =
    | { state: "connected"; user: HardcoverUser }
    | { state: "error"; kind: HardcoverError["kind"]; message: string };

export async function checkHardcoverConnection(): Promise<HardcoverConnection> {
    try {
        return { state: "connected", user: await getMe() };
    } catch (error) {
        if (error instanceof HardcoverError) {
            return { state: "error", kind: error.kind, message: error.message };
        }
        throw error;
    }
}
