// Routes de synchronisation Kataleya — modèle A+B hybride, LWW serveur-arbitre.
//
// Flux nominal (Phase 4+) :
//   • Client → GET /sync-state?since=<v> : inventaire des lignes modifiées
//     depuis sa dernière version connue. Pas de filtre client_id — chacun voit
//     tout, l'arbitrage LWW se fait à l'écriture.
//   • Client → GET /sync-state/full?table=…&since=… : payload joint
//     sync_state + lignes métier, pour rattraper une table en un seul appel.
//   • Client → GET /api/sync/:table/:id : récupère la row canonique d'une
//     entrée (utilisé après une entrée pull non-suppression).
//   • Client → POST/PUT/DELETE /:table[/:id] : applique localement puis push
//     avec `_version`/`_updatedAt`. Le serveur arbitre via `arbitrateLWW` et
//     répond `{applied: "client" | "server", currentVersion, data?}`.
//   • WebSocket /api/sync/ws (Durable Object SyncRoom) : notification push
//     temps réel. Le client reçoit un `journal_update` et appelle `requestSync()`.
//
// `sync_journal` n'est plus la source de vérité du pull : démoté en audit log
// append-only (cf. GET /journal). `sync_state` est l'unique état autoritaire.

import { Hono, type Context } from "hono";
import type { Env, Variables } from "../types";
import { buildModels, isSyncableTable } from "../models";

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

function bad(c: Ctx, msg: string, code = 400) {
    return c.json({ error: msg }, code as any);
}

function genId(prefix = "srv"): string {
    return `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

function nowISO(): string {
    return new Date().toISOString();
}

// D1 ne sait binder que des scalaires (string/number/null/ArrayBuffer).
// Les clients envoient des champs comme technicienIds: [] (vrai tableau JS).
// On sérialise donc tout tableau/objet en JSON string avant écriture,
// et on supprime les undefined (non bindables non plus).
function normalizeForD1(
    body: Record<string, unknown>,
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
        if (value === undefined) continue;
        if (value !== null && typeof value === "object") {
            out[key] = JSON.stringify(value);
        } else if (typeof value === "boolean") {
            out[key] = value ? 1 : 0;
        } else {
            out[key] = value;
        }
    }
    return out;
}

function errMsg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// Phase 2.3 — arbitrage LWW serveur-prioritaire.
// Règle :
//  • body._version absent  → pas d'arbitrage (compat ancien client) → apply.
//  • body._version === currentServerVersion → apply (bump +1).
//  • body._version  <  currentServerVersion → server gagne, on renvoie la row
//    canonique avec applied="server" et currentVersion serveur.
//  • body._version  >  currentServerVersion → ne devrait pas arriver, on apply
//    pour rester self-healing.
// `_updatedAt` est uniquement informatif pour l'instant (tracé dans logs si
// divergence) — la version entière reste l'autorité.
type LwwDecision =
    | { apply: true; cleanBody: Record<string, unknown> }
    | {
          apply: false;
          response: { applied: "server"; currentVersion: number; data: unknown };
      };

async function arbitrateLWW(
    c: Ctx,
    table: string,
    id: string,
    body: Record<string, unknown>,
): Promise<LwwDecision> {
    const { _version, _updatedAt, ...cleanBody } = body as Record<string, unknown> & {
        _version?: number;
        _updatedAt?: string;
    };
    if (typeof _version !== "number") {
        return { apply: true, cleanBody };
    }
    const { orm } = buildModels(c.env.DB);
    const rows = await orm
        .query<{ version: number; updatedAt: string }>(
            `SELECT version, updatedAt FROM sync_state
             WHERE table_name = ? AND element_id = ?`,
            [table, id],
        )
        .catch(() => []);
    const current = rows[0];
    if (!current) return { apply: true, cleanBody };

    if (_version >= current.version) {
        return { apply: true, cleanBody };
    }

    // Client en retard → on lui renvoie la row canonique du serveur.
    const models = buildModels(c.env.DB) as any;
    const canonical = await models[table].findById(id).catch(() => null);
    if (_updatedAt && _updatedAt > current.updatedAt) {
        console.warn(
            `[sync_state] LWW ${table}/${id} : client _updatedAt (${_updatedAt}) ` +
                `> server updatedAt (${current.updatedAt}) mais _version obsolète ` +
                `(${_version} < ${current.version}). Version reste l'autorité.`,
        );
    }
    return {
        apply: false,
        response: {
            applied: "server",
            currentVersion: current.version,
            data: canonical,
        },
    };
}

// Phase 1.3 — bump atomique de sync_state pour une ligne donnée.
// UPSERT : crée la row si absente (version=1), sinon incrémente version.
// updatedAt/updatedBy sont écrasés à chaque write pour refléter le dernier acteur.
async function bumpSyncState(
    c: Ctx,
    table: string,
    id: string,
    deleted: boolean,
): Promise<void> {
    const { orm } = buildModels(c.env.DB);
    const userId = c.get("userId") || "unknown";
    const now = nowISO();
    try {
        await orm.run(
            `INSERT INTO sync_state (table_name, element_id, version, updatedAt, updatedBy, deleted)
             VALUES (?, ?, 1, ?, ?, ?)
             ON CONFLICT(table_name, element_id) DO UPDATE SET
                 version   = sync_state.version + 1,
                 updatedAt = excluded.updatedAt,
                 updatedBy = excluded.updatedBy,
                 deleted   = excluded.deleted`,
            [table, id, now, userId, deleted ? 1 : 0],
        );
    } catch (e) {
        console.error(`[sync_state] bump ${table}/${id} échec`, errMsg(e));
    }
}

async function logJournal(
    c: Ctx,
    operation: "create" | "update" | "delete",
    table_name: string,
    id_element: string,
    data: unknown | null,
): Promise<string> {
    const { SyncJournal } = buildModels(c.env.DB);
    const id = genId();
    const clientId = c.req.header("X-Client-ID") || "unknown";
    const userId = c.get("userId") || "unknown";
    await SyncJournal.create({
        id,
        operation,
        id_element,
        table_name,
        timestamp: nowISO(),
        client_id: clientId,
        user_id: userId,
        data: data ? JSON.stringify(data) : null,
    });
    return id;
}

// Notification push temps réel via Durable Object SyncRoom.
// Tous les clients WebSocket connectés reçoivent l'événement et
// déclenchent un `requestSync()` debouncé côté client.
function broadcastToDO(
    c: Ctx,
    table: string,
    id: string,
    operation: "create" | "update" | "delete",
): void {
    try {
        const stub = c.env.SYNC_ROOM.getByName("global");
        const clientId = c.req.header("X-Client-ID") || "unknown";
        c.executionCtx.waitUntil(
            stub.broadcast(table, id, operation, clientId),
        );
    } catch {
        /* DO non configuré → silencieux */
    }
}

// ─── GET /sync-state?sinceVersion=<v>&sinceTable=<t>&sinceId=<id>&limit=<n> ──
// Phase 2.1 — inventaire des lignes modifiées depuis le curseur.
// Pagination par tuple (version, table_name, element_id) pour garantir
// qu'aucune ligne n'est sautée même quand plusieurs partagent la même version.
// `since` (ancien format, mappe sur sinceVersion) conservé pour compat.
app.get("/sync-state", async (c) => {
    const limitRaw = Number(c.req.query("limit") ?? "1000") || 1000;
    const limit = Math.min(Math.max(limitRaw, 1), 5000);
    const sinceVersion = Number(c.req.query("sinceVersion") ?? c.req.query("since") ?? "0") || 0;
    const sinceTable = c.req.query("sinceTable") || "";
    const sinceId = c.req.query("sinceId") || "";

    const { orm } = buildModels(c.env.DB);

    const items = await orm.query<{
        table_name: string;
        element_id: string;
        version: number;
        updatedAt: string;
        updatedBy: string;
        deleted: number;
    }>(
        `SELECT table_name, element_id, version, updatedAt, updatedBy, deleted
         FROM sync_state
         WHERE version > ?
            OR (version = ? AND table_name > ?)
            OR (version = ? AND table_name = ? AND element_id > ?)
         ORDER BY version ASC, table_name ASC, element_id ASC
         LIMIT ?`,
        [sinceVersion, sinceVersion, sinceTable, sinceVersion, sinceTable, sinceId, limit + 1],
    );
    const hasMore = items.length > limit;
    if (hasMore) items.pop();

    // Curseur suivant = dernier élément retourné (pas le MAX global)
    const last = items[items.length - 1];
    const nextVersion = last?.version ?? 0;
    const nextTable = last?.table_name ?? "";
    const nextId = last?.element_id ?? "";

    return c.json({
        items: items.map((r) => ({
            table: r.table_name,
            id: r.element_id,
            version: r.version,
            updatedAt: r.updatedAt,
            updatedBy: r.updatedBy,
            deleted: r.deleted === 1,
        })),
        maxVersion: nextVersion,
        maxTable: nextTable,
        maxId: nextId,
        hasMore,
        serverTime: nowISO(),
    });
});

// ─── GET /sync-state/full?table=<name>&sinceVersion=<v>&sinceId=<id> ──
// Phase 2.2 — payload joint : sync_state + lignes métier de la table.
// Pratique pour un client qui veut rattraper son retard sur une table précise
// sans faire N round-trips. `deleted=1` → row absente de `rows`.
//
// Pagination par tuple (version, element_id) : contrairement à `version`
// seul, ce curseur est unique par ligne et ne manque aucun élément même
// quand plusieurs lignes partagent la même version (cas du seed initial
// où tout est à version=1). `since` (ancien format) est conservé pour
// compatibilité descendante et mappe sur `sinceVersion`.
app.get("/sync-state/full", async (c) => {
    const table = c.req.query("table") || "";
    if (!isSyncableTable(table)) return bad(c, "table inconnue", 404);

    const limitRaw = Number(c.req.query("limit") ?? "1000") || 1000;
    const limit = Math.min(Math.max(limitRaw, 1), 5000);

    // Curseur tuple (version, element_id) — `since` conservé pour compat
    const sinceVersion = Number(c.req.query("sinceVersion") ?? c.req.query("since") ?? "0") || 0;
    const sinceId = c.req.query("sinceId") || "";

    const { orm } = buildModels(c.env.DB);

    const states = await orm.query<{
        element_id: string;
        version: number;
        updatedAt: string;
        updatedBy: string;
        deleted: number;
    }>(
        `SELECT element_id, version, updatedAt, updatedBy, deleted
         FROM sync_state
         WHERE table_name = ?
           AND (version > ? OR (version = ? AND element_id > ?))
         ORDER BY version ASC, element_id ASC
         LIMIT ?`,
        [table, sinceVersion, sinceVersion, sinceId, limit + 1],
    );
    const hasMore = states.length > limit;
    if (hasMore) states.pop();

    const liveIds = states.filter((s) => s.deleted !== 1).map((s) => s.element_id);
    let rowsById = new Map<string, Record<string, unknown>>();
    if (liveIds.length > 0) {
        const placeholders = liveIds.map(() => "?").join(",");
        const rows = await orm.query<Record<string, unknown> & { id: string }>(
            `SELECT * FROM ${table} WHERE id IN (${placeholders})`,
            liveIds,
        );
        rowsById = new Map(rows.map((r) => [String(r.id), r]));
    }

    // Le curseur suivant est le dernier élément retourné (pas le MAX global)
    const last = states[states.length - 1];
    const nextVersion = last?.version ?? 0;
    const nextId = last?.element_id ?? "";

    return c.json({
        table,
        items: states.map((s) => ({
            id: s.element_id,
            version: s.version,
            updatedAt: s.updatedAt,
            updatedBy: s.updatedBy,
            deleted: s.deleted === 1,
            data: s.deleted === 1 ? null : rowsById.get(s.element_id) ?? null,
        })),
        maxVersion: nextVersion,
        maxId: nextId,
        hasMore,
        serverTime: nowISO(),
    });
});

// ─── GET /journal?since=<ISO> ────────────────────────────────────────
// Phase 6 — démoté en audit log. Plus consulté pour le pull primaire
// (sync_state s'en charge). Cet endpoint reste exposé pour diagnostic et
// historique : plus de filtre `client_id != ?`, chaque appelant voit le
// journal complet trié par `timestamp`.
app.get("/journal", async (c) => {
    const since = c.req.query("since") || "";
    const { orm } = buildModels(c.env.DB);

    const sql = since
        ? `SELECT id, operation, id_element, table_name, timestamp, client_id FROM sync_journal
           WHERE timestamp > ? ORDER BY timestamp ASC LIMIT 1000`
        : `SELECT id, operation, id_element, table_name, timestamp, client_id FROM sync_journal
           ORDER BY timestamp ASC LIMIT 1000`;
    const params = since ? [since] : [];

    const rows = await orm.query<any>(sql, params);
    return c.json({
        journal: rows.map((r) => ({
            id: r.id,
            operation: r.operation,
            id_element: r.id_element,
            table_name: r.table_name,
            timestamp: r.timestamp,
        })),
        serverTime: nowISO(),
    });
});

// ─── GET /api/sync/:table/:id ────────────────────────────────────────
app.get("/api/sync/:table/:id", async (c) => {
    const table = c.req.param("table");
    const id = c.req.param("id");
    if (!isSyncableTable(table)) return bad(c, "table inconnue", 404);
    const models = buildModels(c.env.DB) as any;
    const row = await models[table].findById(id);
    if (!row) return bad(c, "introuvable", 404);
    return c.json(row);
});

// ─── POST /:table  (create-or-update) ────────────────────────────────
// Idempotent : si la ligne existe déjà, on patche les colonnes présentes
// dans le body ; sinon on insère.
app.post("/:table", async (c) => {
    const table = c.req.param("table");
    if (!isSyncableTable(table)) return bad(c, "table inconnue", 404);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body || !body.id) return bad(c, "id requis");

    const id = String(body.id);
    const decision = await arbitrateLWW(c, table, id, body);
    if (!decision.apply) return c.json(decision.response);

    const models = buildModels(c.env.DB) as any;
    const normalized = normalizeForD1(decision.cleanBody);
    const existing = await models[table].findById(id).catch(() => null);
    try {
        if (existing) {
            const { id: _ignore, ...patch } = normalized;
            await models[table].update(id, patch);
        } else {
            await models[table].upsert({ ...normalized, id });
        }
    } catch (e) {
        console.error(`[sync] POST /${table} échec écriture`, id, errMsg(e));
        return bad(c, `écriture impossible: ${errMsg(e)}`, 422);
    }
    await bumpSyncState(c, table, id, false);
    const journalId = await logJournal(c, "create", table, id, decision.cleanBody);
    broadcastToDO(c, table, id, "create");
    const { orm } = buildModels(c.env.DB);
    const after = await orm.query<{ version: number }>(
        `SELECT version FROM sync_state WHERE table_name = ? AND element_id = ?`,
        [table, id],
    );
    return c.json({
        ok: true,
        applied: "client",
        currentVersion: after[0]?.version ?? 1,
        journalId,
    });
});

// ─── PUT /:table/:id  (update) ───────────────────────────────────────
// PATCH différentiel : ne modifie QUE les colonnes présentes dans le body.
// Si la ligne n'existe pas encore côté serveur, on upsert avec ce qu'on a
// (le client devrait avoir envoyé le CREATE avant, mais on tolère).
app.put("/:table/:id", async (c) => {
    const table = c.req.param("table");
    const id = c.req.param("id");
    if (!isSyncableTable(table)) return bad(c, "table inconnue", 404);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body || typeof body !== "object" || Object.keys(body).length === 0) {
        return bad(c, "body vide", 422);
    }

    const decision = await arbitrateLWW(c, table, id, body);
    if (!decision.apply) return c.json(decision.response);

    const models = buildModels(c.env.DB) as any;
    const normalized = normalizeForD1(decision.cleanBody);
    const existing = await models[table].findById(id).catch(() => null);
    try {
        if (existing) {
            const { id: _ignore, ...patch } = normalized;
            await models[table].update(id, patch);
        } else {
            // PUT idempotent : si la ligne n'existe pas, on l'insère. Si le
            // body est un patch partiel (colonnes NOT NULL manquantes),
            // l'upsert échouera → 422 explicite plutôt qu'un 500 opaque.
            await models[table].upsert({ ...normalized, id });
        }
    } catch (e) {
        console.error(`[sync] PUT /${table}/${id} échec écriture`, errMsg(e), body);
        return bad(c, `écriture impossible: ${errMsg(e)}`, 422);
    }
    await bumpSyncState(c, table, id, false);
    const journalId = await logJournal(c, "update", table, id, decision.cleanBody);
    broadcastToDO(c, table, id, "update");
    const { orm } = buildModels(c.env.DB);
    const after = await orm.query<{ version: number }>(
        `SELECT version FROM sync_state WHERE table_name = ? AND element_id = ?`,
        [table, id],
    );
    return c.json({
        ok: true,
        applied: "client",
        currentVersion: after[0]?.version ?? 1,
        journalId,
    });
});

// ─── DELETE /:table/:id ──────────────────────────────────────────────
// Idempotent : si la ligne n'existe pas, on swallow l'erreur et on journalise
// quand même pour que les autres clients voient la suppression.
// LWW : si `_version` est fourni (body ou query), on arbitre avant de supprimer.
app.delete("/:table/:id", async (c) => {
    const table = c.req.param("table");
    const id = c.req.param("id");
    if (!isSyncableTable(table)) return bad(c, "table inconnue", 404);

    // Lecture du _version : body JSON d'abord, puis query param
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const _version =
        typeof body._version === "number"
            ? body._version
            : Number(c.req.query("_version")) || undefined;

    if (typeof _version === "number") {
        const decision = await arbitrateLWW(c, table, id, {
            _version,
            id,
        });
        if (!decision.apply) return c.json(decision.response);
    }

    const models = buildModels(c.env.DB) as any;
    await models[table].deleteById(id).catch(() => undefined);
    await bumpSyncState(c, table, id, true);
    const journalId = await logJournal(c, "delete", table, id, null);
    broadcastToDO(c, table, id, "delete");
    const { orm } = buildModels(c.env.DB);
    const after = await orm.query<{ version: number }>(
        `SELECT version FROM sync_state WHERE table_name = ? AND element_id = ?`,
        [table, id],
    );
    return c.json({
        ok: true,
        journalId,
        currentVersion: after[0]?.version ?? 1,
        applied: "client",
    });
});

// ─── SSE /api/sync/events (DEPRECATED) ───────────────────────────────
// Remplacé par WebSocket /api/sync/ws via Durable Object SyncRoom.
// Conservé pour compatibilité avec les anciens clients. Sera supprimé
// après la migration complète vers le DO.
// Polling-based stream: vérifie le journal toutes les 3s pendant 25s.
app.get("/api/sync/events", async (c) => {
    const { orm } = buildModels(c.env.DB);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            let lastTs = nowISO();
            const send = (payload: unknown) => {
                controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
                );
            };
            send({ type: "hello", serverTime: lastTs });

            const start = Date.now();
            while (Date.now() - start < 25_000) {
                await new Promise((r) => setTimeout(r, 3000));
                try {
                    // Phase 6 — plus de filtre client_id. SSE = trigger pur :
                    // le client reçoit aussi ses propres événements mais sa
                    // logique requestSync() est debouncée, donc inoffensif.
                    const rows = await orm.query<any>(
                        `SELECT id, operation, id_element, table_name, timestamp, client_id
                         FROM sync_journal
                         WHERE timestamp > ?
                         ORDER BY timestamp ASC LIMIT 100`,
                        [lastTs],
                    );
                    for (const r of rows) {
                        send({
                            type: "journal_update",
                            clientId: r.client_id,
                            entry: {
                                id: r.id,
                                operation: r.operation,
                                id_element: r.id_element,
                                table_name: r.table_name,
                                timestamp: r.timestamp,
                            },
                        });
                        lastTs = r.timestamp;
                    }
                } catch {
                    /* swallow */
                }
            }
            controller.close();
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
});

export default app;