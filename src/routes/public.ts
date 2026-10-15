import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { buildModels } from "../models";
import { issueToken, verifyPassword, verifyToken } from "../lib/auth";

// Routes publiques exposées au site internet (vitrine).
// — GET /public/collections, /public/sous-collections, /public/articles : lecture
//   anonyme des items `actif` (et `stockTotal > 0` pour les articles).
// — POST /public/login : authentifie un super_admin et renvoie un JWT scopé
//   (claim `aud:"website"`) utilisable pour les endpoints réservés du site.
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.get("/public/collections", async (c) => {
    const { orm } = buildModels(c.env.DB);
    const rows = await orm.query(
        `SELECT id, nom, description, ordre, quantite, createdAt, updatedAt
         FROM collections
         WHERE statut = 'actif'
         ORDER BY COALESCE(ordre, 999999), nom`,
        [],
    );
    return c.json({ items: rows });
});

app.get("/public/sous-collections", async (c) => {
    const { orm } = buildModels(c.env.DB);
    const collectionId = c.req.query("collectionId");
    const sql = collectionId
        ? `SELECT id, collectionId, nom, description, image, ordre, createdAt, updatedAt
           FROM sous_collections
           WHERE statut = 'actif' AND collectionId = ?
           ORDER BY COALESCE(ordre, 999999), nom`
        : `SELECT id, collectionId, nom, description, image, ordre, createdAt, updatedAt
           FROM sous_collections
           WHERE statut = 'actif'
           ORDER BY COALESCE(ordre, 999999), nom`;
    const rows = await orm.query(sql, collectionId ? [collectionId] : []);
    return c.json({ items: rows });
});

app.get("/public/articles", async (c) => {
    const { orm } = buildModels(c.env.DB);
    const collectionId = c.req.query("collectionId");
    const sousCollectionId = c.req.query("sousCollectionId");
    const search = c.req.query("q")?.trim().toLowerCase();
    const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 200);
    const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);

    const where: string[] = ["statut = 'actif'", "stockTotal > 0", "(prive IS NULL OR prive = 0)"];
    const args: unknown[] = [];
    if (collectionId) {
        where.push("collectionId = ?");
        args.push(collectionId);
    }
    if (sousCollectionId) {
        where.push("sousCollectionId = ?");
        args.push(sousCollectionId);
    }
    if (search) {
        where.push("(LOWER(nom) LIKE ? OR LOWER(reference) LIKE ?)");
        const like = `%${search}%`;
        args.push(like, like);
    }

    const sql = `SELECT id, collectionId, sousCollectionId, nom, description, reference,
                        unite, prixHT, tauxTVA, prixTTC, dimensions, images, stockTotal,
                        createdAt, updatedAt
                 FROM articles
                 WHERE ${where.join(" AND ")}
                 ORDER BY nom
                 LIMIT ? OFFSET ?`;
    args.push(limit, offset);
    const rows = await orm.query(sql, args);

    const countSql = `SELECT COUNT(*) as n FROM articles WHERE ${where.join(" AND ")}`;
    const countRows = await orm.query<{ n: number }>(
        countSql,
        args.slice(0, args.length - 2),
    );
    const total = Number(countRows[0]?.n ?? 0);

    return c.json({ items: rows, total, limit, offset });
});

app.get("/public/articles/:id", async (c) => {
    const { articles } = buildModels(c.env.DB);
    const row = await articles.findById(c.req.param("id"));
    if (!row || row.statut !== "actif" || row.prive) {
        return c.json({ error: "introuvable" }, 404);
    }
    return c.json(row);
});

// Handshake de liaison poste ↔ serveur. Le super_admin prouve qu'il autorise
// ce poste à se synchroniser avec ce serveur. Aucun token n'est émis : c'est
// juste une validation d'autorisation. Le poste enregistre ensuite l'URL
// serveur en local, puis l'utilisateur final passe par /public/login.
app.post("/public/link-device", async (c) => {
    const body = await c.req.json<{ email: string; password: string }>();
    if (!body?.email || !body?.password) {
        return c.json({ error: "email et password requis" }, 400);
    }
    const { administrateurs } = buildModels(c.env.DB);
    const admin = await administrateurs.findOne({ where: { email: body.email } });
    if (!admin) return c.json({ error: "identifiants invalides" }, 401);
    if (admin.role !== "super_admin") {
        return c.json({ error: "liaison réservée au super_admin" }, 403);
    }
    if (admin.statut !== "actif") {
        return c.json({ error: "compte désactivé" }, 401);
    }
    const ok = await verifyPassword(body.password, admin.motDePasseHash);
    if (!ok) return c.json({ error: "identifiants invalides" }, 401);
    return c.json({ ok: true });
});

// Login de l'utilisateur final du poste : n'importe quel rôle actif.
// Sert à initier la session puis à demander le hash via /public/sync-credentials
// pour permettre les logins hors-ligne ultérieurs contre le hash local.
app.post("/public/login", async (c) => {
    const body = await c.req.json<{ email: string; password: string }>();
    if (!body?.email || !body?.password) {
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
});

// Cache du hash mot de passe côté poste pour permettre des logins hors-ligne.
// Appelé une fois après /public/login. Renvoie uniquement le hash de l'user
// du token (jamais d'un autre user).
app.post("/public/sync-credentials", async (c) => {
    const header = c.req.header("Authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) return c.json({ error: "token manquant" }, 401);
    try {
        const payload = await verifyToken(c.env.JWT_SECRET, token);
        const { administrateurs } = buildModels(c.env.DB);
        const admin = await administrateurs.findById(payload.sub);
        if (!admin) return c.json({ error: "introuvable" }, 404);
        if (admin.statut !== "actif") {
            return c.json({ error: "compte désactivé" }, 401);
        }
        return c.json({ motDePasseHash: admin.motDePasseHash });
    } catch {
        return c.json({ error: "token invalide" }, 401);
    }
});

// Vérification de session : tous rôles actifs.
app.get("/public/me", async (c) => {
    const header = c.req.header("Authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) return c.json({ error: "token manquant" }, 401);
    try {
        const payload = await verifyToken(c.env.JWT_SECRET, token);
        const { administrateurs } = buildModels(c.env.DB);
        const admin = await administrateurs.findById(payload.sub);
        if (!admin) return c.json({ error: "introuvable" }, 404);
        if (admin.statut !== "actif") {
            return c.json({ error: "compte désactivé" }, 401);
        }
        return c.json({
            id: admin.id,
            email: admin.email,
            nom: admin.nom,
            prenom: admin.prenom,
            role: admin.role,
        });
    } catch {
        return c.json({ error: "token invalide" }, 401);
    }
});

export default app;
