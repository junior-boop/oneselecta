import type { DurableObjectNamespace } from "@cloudflare/workers-types";
import type { SyncRoom } from "./sync-room";

export type Env = {
    DB: D1Database;
    IMAGES: R2Bucket;
    JWT_SECRET: string;
    JWT_ISSUER: string;
    SYNC_ROOM: DurableObjectNamespace<SyncRoom>;
};

export type Variables = {
    userId: string;
    userRole: string;
    userEmail: string;
};
