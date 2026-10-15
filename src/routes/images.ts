import { Hono } from "hono";
import type { Env, Variables } from "../types";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Filename safe : on n'autorise que basename (pas de slash, pas de ..)
function safeName(name: string): string | null {
    if (!name) return null;
    if (name.includes("/") || name.includes("\\")) return null;
    if (name === "." || name === "..") return null;
    if (name.length > 255) return null;
    return name;
}

function contentTypeFor(name: string): string {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    switch (ext) {
        case "png": return "image/png";
        case "jpg":
        case "jpeg": return "image/jpeg";
        case "gif": return "image/gif";
        case "webp": return "image/webp";
        case "svg": return "image/svg+xml";
        default: return "application/octet-stream";
    }
}

// PUT /images/:name — upload binaire. Idempotent (overwrite).
app.put("/images/:name", async (c) => {
    const name = safeName(c.req.param("name"));
    if (!name) return c.json({ error: "nom invalide" }, 400);
    const body = await c.req.arrayBuffer();
    if (!body || body.byteLength === 0) {
        return c.json({ error: "body vide" }, 400);
    }
    await c.env.IMAGES.put(name, body, {
        httpMetadata: { contentType: contentTypeFor(name) },
    });
    return c.json({ ok: true, name, size: body.byteLength });
});

// HEAD /images/:name — existence check (peu coûteux, évite de re-télécharger).
app.on("HEAD", "/images/:name", async (c) => {
    const name = safeName(c.req.param("name"));
    if (!name) return new Response(null, { status: 400 });
    const obj = await c.env.IMAGES.head(name);
    if (!obj) return new Response(null, { status: 404 });
    return new Response(null, {
        status: 200,
        headers: {
            "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
            "Content-Length": String(obj.size),
        },
    });
});

// GET /images/:name — download binaire.
app.get("/images/:name", async (c) => {
    const name = safeName(c.req.param("name"));
    if (!name) return c.json({ error: "nom invalide" }, 400);
    const obj = await c.env.IMAGES.get(name);
    if (!obj) return c.json({ error: "introuvable" }, 404);
    return new Response(obj.body, {
        headers: {
            "Content-Type": obj.httpMetadata?.contentType ?? contentTypeFor(name),
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    });
});

// DELETE /images/:name — suppression (utilisée lors du nettoyage d'article).
app.delete("/images/:name", async (c) => {
    const name = safeName(c.req.param("name"));
    if (!name) return c.json({ error: "nom invalide" }, 400);
    await c.env.IMAGES.delete(name);
    return c.json({ ok: true });
});

export default app;
