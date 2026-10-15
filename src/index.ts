import { Hono, type Context, type Next } from "hono";
import { cors } from "hono/cors";
import type { Env, Variables } from "./types";
import { verifyToken } from "./lib/auth";
import { buildModels, initDatabase, SYNCABLE_TABLES } from "./models";
import authRoutes from "./routes/auth";
import syncRoutes from "./routes/sync";
import imagesRoutes from "./routes/images";
import publicRoutes from "./routes/public";
import updateRoutes from "./routes/update";
import { SyncRoom } from "./sync-room";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Auto-init D1 : une seule fois par isolate Worker. initDatabase() est idempotent
// (CREATE TABLE IF NOT EXISTS), donc sûr à exécuter au premier cold start.
let initPromise: Promise<void> | null = null;
function ensureInit(db: D1Database): Promise<void> {
    if (!initPromise) {
        initPromise = initDatabase(db).catch((e) => {
            initPromise = null; // permet une nouvelle tentative au prochain appel
            throw e;
        });
    }
    return initPromise;
}

app.use("*", async (c, next) => {
    await ensureInit(c.env.DB);
    await next();
});

app.use(
    "*",
    cors({
        origin: "*",
        allowHeaders: [
            "Authorization",
            "Content-Type",
            "X-Client-ID",
            "X-Journal-ID",
        ],
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    }),
);

app.get("/health", (c) => c.json({ ok: true, time: Date.now() }));

async function requireAuth(
    c: Context<{ Bindings: Env; Variables: Variables }>,
    next: Next,
) {
    const header = c.req.header("Authorization");
    // EventSource ne peut pas envoyer de header Authorization → fallback query
    // `?token=...` accepté uniquement si pas de header (et toujours validé).
    let token: string | undefined;
    if (header?.startsWith("Bearer ")) {
        token = header.slice(7);
    } else {
        token = c.req.query("token");
    }
    if (!token) {
        return c.json({ error: "token manquant" }, 401);
    }
    try {
        const payload = await verifyToken(c.env.JWT_SECRET, token!);
        c.set("userId", payload.sub);
        c.set("userRole", payload.role);
        c.set("userEmail", payload.email);
    } catch {
        return c.json({ error: "token invalide" }, 401);
    }
    await next();
}

// Routes protégées
app.use("/me", requireAuth);
app.use("/journal", requireAuth);
app.use("/api/sync/*", requireAuth);
app.use("/admin/status", requireAuth);
app.use("/admin/sync-state", requireAuth);
app.use("/admin/init", requireAuth);
app.use("/register", requireAuth);
app.use("/sync-state", requireAuth);
app.use("/sync-state/*", requireAuth);
app.use("/images/*", requireAuth);

// Initialisation idempotente des tables D1 (appelée à la demande). Réservé au
// super_admin : la création de tables en production ne doit pas être exposée à
// tous les utilisateurs authentifiés.
app.post("/admin/init", async (c) => {
    if (c.get("userRole") !== "super_admin") {
        return c.json({ error: "réservé au super_admin" }, 403);
    }
    await initDatabase(c.env.DB);
    return c.json({ ok: true, tables: SYNCABLE_TABLES });
});

// État global du serveur : utilisé par le client pour décider s'il doit faire
// un bootstrap (push initial des données locales) quand le D1 est vide.
app.get("/admin/status", async (c) => {
    const { orm } = buildModels(c.env.DB);
    const counts: Record<string, number> = {};
    for (const t of SYNCABLE_TABLES) {
        try {
            const rows = await orm.query<{ n: number }>(
                `SELECT COUNT(*) as n FROM ${t}`,
                [],
            );
            counts[t] = Number(rows[0]?.n ?? 0);
        } catch {
            counts[t] = 0;
        }
    }
    // `administrateurs` est exclu du calcul "empty" : un compte admin existe
    // forcément côté serveur (sinon personne ne pourrait s'y connecter), donc
    // sa présence ne doit pas empêcher le bootstrap initial des autres tables.
    const empty = Object.entries(counts)
        .filter(([t]) => t !== "administrateurs")
        .every(([, n]) => n === 0);
    return c.json({ empty, counts });
});
// Inspection de sync_state — sert de test pour les jalons Phase 1.
app.get("/admin/sync-state", async (c) => {
    const { orm } = buildModels(c.env.DB);
    const total = await orm
        .query<{ n: number }>(`SELECT COUNT(*) as n FROM sync_state`, [])
        .catch(() => [{ n: 0 } as { n: number }]);
    const maxV = await orm
        .query<{ v: number | null }>(
            `SELECT MAX(version) as v FROM sync_state`,
            [],
        )
        .catch(() => [{ v: 0 } as { v: number | null }]);
    const byTable = await orm
        .query<{ table_name: string; n: number; maxVersion: number }>(
            `SELECT table_name, COUNT(*) as n, MAX(version) as maxVersion
             FROM sync_state GROUP BY table_name ORDER BY table_name`,
            [],
        )
        .catch(() => []);
    return c.json({
        total: Number(total[0]?.n ?? 0),
        maxVersion: Number(maxV[0]?.v ?? 0),
        byTable,
    });
});

for (const t of SYNCABLE_TABLES) {
    app.use(`/${t}`, requireAuth);
    app.use(`/${t}/*`, requireAuth);
}

// ─── WebSocket temps réel via Durable Object (remplace le SSE polling) ───
app.get("/api/sync/ws", async (c) => {
    const userId = c.get("userId");
    const url = new URL(c.req.url);
    url.searchParams.set("x-user-id", userId);
    const req = new Request(url.toString(), {
        method: c.req.raw.method,
        headers: c.req.raw.headers,
    });
    return c.env.SYNC_ROOM.getByName("global").fetch(req);
});

// Routes publiques (site internet) — montées AVANT syncRoutes pour passer
// avant le handler générique `POST /:table` / `PUT /:table/:id`.
app.route("/", publicRoutes);
// Route publique de mise à jour applicative — sert latest.json et les
// installateurs depuis R2 (prefix "release/"). MONTÉE AVANT authRoutes
// car aucun token requis.
app.route("/", updateRoutes);

app.route("/", authRoutes);
// imagesRoutes AVANT syncRoutes : sync définit un PUT/:table/:id générique qui
// matcherait /images/:name et renverrait 404 (table inconnue). Ordre = priorité.
app.route("/", imagesRoutes);
app.route("/", syncRoutes);

export { SyncRoom };
export default app;
