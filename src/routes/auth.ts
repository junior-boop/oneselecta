import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { buildModels, type Administrateur } from "../models";
import { hashPassword, issueToken, verifyPassword } from "../lib/auth";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const ADMIN_ROLES = new Set(["super_admin", "admin"]);

app.post("/login", async (c) => {
    try {
        const body = await c.req.json<{ email: string; password: string }>();
        if (!body.email || !body.password) {
            return c.json({ error: "email et password requis" }, 400);
        }
        const { administrateurs } = buildModels(c.env.DB);
        const admin = await administrateurs.findOne({ where: { email: body.email } });
        if (!admin) return c.json({ error: "identifiants invalides" }, 401);
        if (admin.statut !== "actif") {
            return c.json({ error: "compte désactivé" }, 401);
        }
        const ok = await verifyPassword(body.password, admin.motDePasseHash);
        if (!ok) return c.json({ error: "identifiants invalides" }, 401);

        const now = new Date().toISOString();
        await administrateurs.update(admin.id, {
            derniereConnexion: now,
            updatedAt: now,
        });

        const token = await issueToken(c.env.JWT_SECRET, c.env.JWT_ISSUER, {
            id: admin.id,
            email: admin.email,
            role: admin.role,
        });
        return c.json({
            token,
            user: {
                id: admin.id,
                email: admin.email,
                nom: admin.nom,
                prenom: admin.prenom,
                role: admin.role,
            },
        });
    } catch (e) {
        const err = e as Error;
        console.error("[/login] 500", err?.stack || err?.message || err);
        return c.json(
            { error: "login failed", detail: err?.message ?? String(e) },
            500,
        );
    }
});

app.get("/me", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "non authentifié" }, 401);
    const { administrateurs } = buildModels(c.env.DB);
    const admin = await administrateurs.findById(userId);
    if (!admin) return c.json({ error: "introuvable" }, 404);
    return c.json({
        id: admin.id,
        email: admin.email,
        nom: admin.nom,
        prenom: admin.prenom,
        role: admin.role,
    });
});

// Indique au client si la table administrateurs est vide → utilisé pour décider
// s'il faut faire un pré-bootstrap (push des admins locaux) avant de tenter
// /login. Route publique : ne révèle que le booléen, aucune donnée sensible.
app.get("/auth/needs-bootstrap", async (c) => {
    const { orm } = buildModels(c.env.DB);
    try {
        const rows = await orm.query<{ n: number }>(
            "SELECT COUNT(*) as n FROM administrateurs",
            [],
        );
        const count = Number(rows[0]?.n ?? 0);
        return c.json({ needsBootstrap: count === 0, count });
    } catch {
        // table absente (au pire) → on considère qu'il faut bootstrap
        return c.json({ needsBootstrap: true, count: 0 });
    }
});

// Pré-bootstrap des comptes admin/super_admin. Route publique mais idempotente
// et gated : refuse si la table administrateurs n'est PAS vide. Permet au tout
// premier client de pousser ses admins sans token (sinon impossibilité totale
// de se logger sur un serveur vide).
app.post("/auth/bootstrap-admins", async (c) => {
    const { orm, administrateurs } = buildModels(c.env.DB);
    const existing = await orm.query<{ n: number }>(
        "SELECT COUNT(*) as n FROM administrateurs",
        [],
    );
    const count = Number(existing[0]?.n ?? 0);
    if (count > 0) {
        return c.json({ error: "déjà initialisé", count }, 409);
    }

    const body = await c.req.json<{ admins: Administrateur[] }>();
    if (!Array.isArray(body?.admins) || body.admins.length === 0) {
        return c.json({ error: "admins[] requis" }, 400);
    }

    const accepted: string[] = [];
    for (const row of body.admins) {
        if (!row?.id || !row.email || !row.motDePasseHash) continue;
        if (!ADMIN_ROLES.has(row.role)) continue;
        try {
            await administrateurs.create({
                id: row.id,
                nom: row.nom,
                prenom: row.prenom,
                email: row.email,
                telephone: row.telephone,
                role: row.role,
                motDePasseHash: row.motDePasseHash,
                avatar: row.avatar,
                statut: row.statut ?? "actif",
                createdAt: row.createdAt ?? new Date().toISOString(),
                updatedAt: row.updatedAt ?? new Date().toISOString(),
                derniereConnexion: row.derniereConnexion,
            });
            accepted.push(row.id);
        } catch (e) {
            console.error("[bootstrap-admins] insert failed", row.id, e);
        }
    }

    if (accepted.length === 0) {
        return c.json({ error: "aucun admin valide" }, 400);
    }
    return c.json({ ok: true, inserted: accepted });
});

// Conservé pour future création serveur-only ; reste basé sur administrateurs.
// Réservé au super_admin (la route est également protégée par requireAuth côté
// index.ts) : n'importe quel utilisateur authentifié ne doit pas pouvoir créer
// un compte admin.
app.post("/register", async (c) => {
    if (c.get("userRole") !== "super_admin") {
        return c.json({ error: "réservé au super_admin" }, 403);
    }
    const body = await c.req.json<{
        email: string;
        password: string;
        nom: string;
        prenom: string;
        role?: string;
    }>();
    if (!body.email || !body.password || !body.nom || !body.prenom) {
        return c.json({ error: "email, password, nom, prenom requis" }, 400);
    }
    const { administrateurs } = buildModels(c.env.DB);
    if (await administrateurs.findOne({ where: { email: body.email } })) {
        return c.json({ error: "email déjà utilisé" }, 409);
    }
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const motDePasseHash = await hashPassword(body.password);
    await administrateurs.create({
        id,
        email: body.email,
        motDePasseHash,
        nom: body.nom,
        prenom: body.prenom,
        role: body.role ?? "admin",
        statut: "actif",
        createdAt: now,
        updatedAt: now,
    });
    const token = await issueToken(c.env.JWT_SECRET, c.env.JWT_ISSUER, {
        id,
        email: body.email,
        role: body.role ?? "admin",
    });
    return c.json({
        token,
        user: { id, email: body.email, nom: body.nom, prenom: body.prenom, role: body.role ?? "admin" },
    });
});

export default app;
