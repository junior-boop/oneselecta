import { DurableObject } from "cloudflare:workers";

export interface Env {
    SYNC_ROOM: DurableObjectNamespace<SyncRoom>;
}

export type BroadcastMessage = {
    type: "journal_update";
    clientId: string;
    entry: {
        table_name: string;
        id_element: string;
        operation: string;
        timestamp: string;
    };
};

export class SyncRoom extends DurableObject<Env> {
    private clients = new Map<WebSocket, { userId: string; joinedAt: number }>();
    private heartbeatHandle: ReturnType<typeof setInterval> | null = null;

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
    }

    async fetch(request: Request): Promise<Response> {
        if (request.headers.get("Upgrade") !== "websocket") {
            return new Response("expected websocket", { status: 426 });
        }

        const url = new URL(request.url);
        const userId = url.searchParams.get("x-user-id") || "unknown";

        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);

        server.accept();
        this.clients.set(server, { userId, joinedAt: Date.now() });

        server.addEventListener("close", () => {
            this.clients.delete(server);
            this.stopHeartbeatIfEmpty();
        });
        server.addEventListener("error", () => {
            this.clients.delete(server);
            this.stopHeartbeatIfEmpty();
        });

        this.ensureHeartbeat();

        return new Response(null, { status: 101, webSocket: client });
    }

    async broadcast(
        table: string,
        id: string,
        operation: string,
        clientId: string,
    ): Promise<void> {
        const message: BroadcastMessage = {
            type: "journal_update",
            clientId,
            entry: {
                table_name: table,
                id_element: id,
                operation,
                timestamp: new Date().toISOString(),
            },
        };
        const raw = JSON.stringify(message);

        let dead: WebSocket[] = [];
        for (const [ws] of this.clients) {
            try {
                ws.send(raw);
            } catch {
                dead.push(ws);
            }
        }
        for (const ws of dead) this.clients.delete(ws);
        this.stopHeartbeatIfEmpty();
    }

    private ensureHeartbeat() {
        if (this.heartbeatHandle) return;
        this.heartbeatHandle = setInterval(() => {
            if (this.clients.size === 0) {
                this.stopHeartbeatIfEmpty();
                return;
            }
            const ping = JSON.stringify({ type: "heartbeat" });
            let dead: WebSocket[] = [];
            for (const [ws] of this.clients) {
                try {
                    ws.send(ping);
                } catch {
                    dead.push(ws);
                }
            }
            for (const ws of dead) this.clients.delete(ws);
        }, 15_000);
    }

    private stopHeartbeatIfEmpty() {
        if (this.clients.size > 0) return;
        if (this.heartbeatHandle !== null) {
            clearInterval(this.heartbeatHandle);
            this.heartbeatHandle = null;
        }
    }
}
