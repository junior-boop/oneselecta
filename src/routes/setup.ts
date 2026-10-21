// Page HTML autonome pour créer ou modifier l'admin principal (super_admin)
// du serveur. Pensée comme un outil de secours/initialisation accessible
// directement depuis un navigateur, sans dépendre du client Electron.
// Protégée par SETUP_SECRET (distinct du JWT_SECRET) plutôt que par un JWT,
// puisqu'elle doit rester utilisable même quand aucun admin n'existe encore.
import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { buildModels } from "../models";
import { hashPassword } from "../lib/auth";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let r = 0;
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
}

function page(opts: {
    message?: { kind: "error" | "success"; text: string };
    values?: { email?: string; nom?: string; prenom?: string; telephone?: string };
}): string {
    const v = opts.values ?? {};
    const banner = opts.message
        ? `<div class="banner ${opts.message.kind}">${escapeHtml(opts.message.text)}</div>`
        : "";
    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kataleya — Admin principal</title>
<style>
  body { font-family: system-ui, sans-serif; background: #f8fafc; margin: 0; padding: 2rem; color: #0f172a; }
  .card { max-width: 420px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 2rem; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
  h1 { font-size: 1.1rem; margin: 0 0 1.5rem; }
  label { display: block; font-size: .8rem; font-weight: 600; margin: .9rem 0 .3rem; }
  input { width: 100%; box-sizing: border-box; padding: .5rem .7rem; border: 1px solid #cbd5e1; border-radius: 8px; font-size: .9rem; }
  small { color: #64748b; }
  button { margin-top: 1.5rem; width: 100%; padding: .6rem; border: none; border-radius: 999px; background: #0f172a; color: #fff; font-size: .9rem; cursor: pointer; }
  .banner { padding: .6rem .8rem; border-radius: 8px; margin-bottom: 1rem; font-size: .85rem; }
  .banner.error { background: #fef2f2; color: #b91c1c; }
  .banner.success { background: #f0fdf4; color: #15803d; }
</style>
</head>
<body>
  <div class="card">
    <h1>Admin principal (super_admin)</h1>
    ${banner}
    <form method="post" action="/admin/setup">
      <label>Clé d'accès</label>
      <input type="password" name="key" required>

      <label>Email</label>
      <input type="email" name="email" required value="${escapeHtml(v.email ?? "")}">

      <label>Nom</label>
      <input type="text" name="nom" required value="${escapeHtml(v.nom ?? "")}">

      <label>Prénom</label>
      <input type="text" name="prenom" required value="${escapeHtml(v.prenom ?? "")}">

      <label>Téléphone</label>
      <input type="text" name="telephone" value="${escapeHtml(v.telephone ?? "")}">

      <label>Mot de passe <small>(laisser vide pour ne pas changer)</small></label>
      <input type="password" name="password" autocomplete="new-password">

      <button type="submit">Enregistrer</button>
    </form>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

app.get("/admin/setup", (c) => c.html(page({})));

app.post("/admin/setup", async (c) => {
    const body = await c.req.parseBody();
    const key = String(body.key ?? "");
    const email = String(body.email ?? "").trim();
    const nom = String(body.nom ?? "").trim();
    const prenom = String(body.prenom ?? "").trim();
    const telephone = String(body.telephone ?? "").trim();
    const password = String(body.password ?? "");
    const values = { email, nom, prenom, telephone };

    if (!c.env.SETUP_SECRET || !timingSafeEqual(key, c.env.SETUP_SECRET)) {
        return c.html(
            page({ message: { kind: "error", text: "Clé d'accès invalide." }, values }),
            403,
        );
    }
    if (!email || !nom || !prenom) {
        return c.html(
            page({ message: { kind: "error", text: "Email, nom et prénom sont requis." }, values }),
            400,
        );
    }

    const { administrateurs } = buildModels(c.env.DB);
    const existing = await administrateurs.findOne({ where: { role: "super_admin" } });
    const now = new Date().toISOString();

    if (existing) {
        const patch: Record<string, unknown> = {
            email,
            nom,
            prenom,
            telephone: telephone || undefined,
            updatedAt: now,
        };
        if (password) patch.motDePasseHash = await hashPassword(password);
        await administrateurs.update(existing.id, patch);
        return c.html(
            page({ message: { kind: "success", text: `Admin principal mis à jour (${email}).` }, values }),
        );
    }

    if (!password) {
        return c.html(
            page({ message: { kind: "error", text: "Mot de passe requis pour la création initiale." }, values }),
            400,
        );
    }
    await administrateurs.create({
        id: crypto.randomUUID(),
        email,
        nom,
        prenom,
        telephone: telephone || undefined,
        role: "super_admin",
        motDePasseHash: await hashPassword(password),
        statut: "actif",
        createdAt: now,
        updatedAt: now,
    });
    return c.html(
        page({ message: { kind: "success", text: `Admin principal créé (${email}).` }, values }),
    );
});

export default app;
